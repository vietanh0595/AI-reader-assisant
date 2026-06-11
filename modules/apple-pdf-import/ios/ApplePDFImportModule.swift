import ExpoModulesCore
import Foundation
import ImageIO
import PDFKit
import UIKit
import Vision

public final class ApplePDFImportModule: Module {
  private struct ExtractedLine {
    let boundingBox: CGRect
    let confidence: Double?
    let text: String
  }

  private let maximumDocumentCharacters = 3_000_000
  private let maximumDocumentPages = 1_500
  private let maximumOcrPages = 40

  public func definition() -> ModuleDefinition {
    Name("ApplePDFImport")

    AsyncFunction("extractDocument") { (documentUri: String) throws -> [String: Any] in
      try self.extractDocument(documentUri)
    }
  }

  private func extractDocument(_ documentUri: String) throws -> [String: Any] {
    let url = try documentUrl(documentUri)
    let isAccessingSecurityScopedResource = url.startAccessingSecurityScopedResource()
    defer {
      if isAccessingSecurityScopedResource {
        url.stopAccessingSecurityScopedResource()
      }
    }

    guard let document = PDFDocument(url: url) else {
      throw moduleError(1, "The selected PDF could not be opened.")
    }

    if document.isLocked {
      throw moduleError(2, "Password-protected PDFs are not supported yet.")
    }

    guard document.pageCount > 0 else {
      throw moduleError(3, "The selected PDF has no pages.")
    }

    guard document.pageCount <= maximumDocumentPages else {
      throw moduleError(4, "This PDF has too many pages. The current limit is \(maximumDocumentPages) pages.")
    }

    let imageOnlyPageCount = (0..<document.pageCount).reduce(into: 0) { count, pageIndex in
      guard let page = document.page(at: pageIndex) else {
        return
      }

      if normalizedText(page.string ?? "").count < 16 {
        count += 1
      }
    }

    guard imageOnlyPageCount <= maximumOcrPages else {
      throw moduleError(
        5,
        "This PDF contains \(imageOnlyPageCount) image-only pages. On-device OCR currently supports up to \(maximumOcrPages) pages per PDF."
      )
    }

    var pages: [[String: Any]] = []
    var totalCharacters = 0

    for pageIndex in 0..<document.pageCount {
      guard let page = document.page(at: pageIndex) else {
        continue
      }

      let pageBounds = page.bounds(for: .cropBox)
      let hasTextLayer = normalizedText(page.string ?? "").count >= 16
      let lines = hasTextLayer ? pdfLines(from: page) : try ocrLines(from: page)
      let shouldSkipPage =
        (pageIndex == 0 && !hasTextLayer && document.pageCount > 1 && isDecorativeCoverPage(lines)) ||
        isPublisherPromoPage(lines)
      let blocks = shouldSkipPage
        ? []
        : groupedBlocks(from: lines, pageBounds: hasTextLayer ? pageBounds : unitBounds)
      let pageLabel = normalizedText(page.label ?? "")
      totalCharacters += blocks.reduce(0) { partial, block in
        partial + ((block["text"] as? String)?.count ?? 0)
      }

      guard totalCharacters <= maximumDocumentCharacters else {
        throw moduleError(
          6,
          "This PDF contains too much text for local library storage. The current limit is \(maximumDocumentCharacters) characters."
        )
      }

      pages.append([
        "blocks": blocks,
        "pageIndex": pageIndex,
        "pageLabel": pageLabel.isEmpty ? "Page \(pageIndex + 1)" : pageLabel,
        "usedOcr": !hasTextLayer,
      ])
    }

    guard totalCharacters > 0 else {
      throw moduleError(7, "No readable text was found in this PDF.")
    }

    let attributes = document.documentAttributes ?? [:]
    let fileTitle = url.deletingPathExtension().lastPathComponent

    return [
      "author": normalizedText(attributes[PDFDocumentAttribute.authorAttribute] as? String ?? ""),
      "outline": outlineEntries(from: document),
      "pageCount": document.pageCount,
      "pages": pages,
      "title": normalizedText(attributes[PDFDocumentAttribute.titleAttribute] as? String ?? "").isEmpty
        ? fileTitle
        : normalizedText(attributes[PDFDocumentAttribute.titleAttribute] as? String ?? ""),
    ]
  }

  private var unitBounds: CGRect {
    CGRect(x: 0, y: 0, width: 1, height: 1)
  }

  private func documentUrl(_ documentUri: String) throws -> URL {
    if let url = URL(string: documentUri), url.scheme != nil {
      return url
    }

    guard !documentUri.isEmpty else {
      throw moduleError(8, "The selected PDF did not provide a valid file location.")
    }

    return URL(fileURLWithPath: documentUri)
  }

  private func pdfLines(from page: PDFPage) -> [ExtractedLine] {
    guard let pageSelection = page.selection(for: page.bounds(for: .cropBox)) else {
      return []
    }

    let lines: [ExtractedLine] = pageSelection.selectionsByLine().compactMap { selection -> ExtractedLine? in
      let text = normalizedText(selection.string ?? "")

      guard !text.isEmpty else {
        return nil
      }

      return ExtractedLine(
        boundingBox: selection.bounds(for: page),
        confidence: nil,
        text: text
      )
    }

    return mergeLineFragments(lines, pageBounds: page.bounds(for: .cropBox))
  }

  private func ocrLines(from page: PDFPage) throws -> [ExtractedLine] {
    let pageBounds = page.bounds(for: .cropBox)
    let longestDimension = max(pageBounds.width, pageBounds.height)
    let scale = longestDimension > 0 ? 1_800 / longestDimension : 1
    let imageSize = CGSize(
      width: max(1, pageBounds.width * scale),
      height: max(1, pageBounds.height * scale)
    )
    let image = page.thumbnail(of: imageSize, for: .cropBox)

    guard let cgImage = image.cgImage else {
      return []
    }

    var requestError: Error?
    var lines: [ExtractedLine] = []
    let request = VNRecognizeTextRequest { request, error in
      if let error {
        requestError = error
        return
      }

      lines = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else {
          return nil
        }

        let text = self.normalizedText(candidate.string)
        return text.isEmpty
          ? nil
          : ExtractedLine(
              boundingBox: observation.boundingBox,
              confidence: Double(candidate.confidence),
              text: text
            )
      }
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.007

    if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = true
    }

    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])

    if let requestError {
      throw requestError
    }

    return lines
  }

  private func groupedBlocks(from sourceLines: [ExtractedLine], pageBounds: CGRect) -> [[String: Any]] {
    guard pageBounds.width > 0, pageBounds.height > 0 else {
      return []
    }

    let lines = sourceLines.filter { !isLikelyPageNumber($0, pageBounds: pageBounds) }

    guard !lines.isEmpty else {
      return []
    }

    let typicalHeight = median(lines.map { $0.boundingBox.height })

    if isContentsPage(lines) {
      return contentsBlocks(from: lines, pageBounds: pageBounds)
    }

    if isTitlePage(lines, typicalHeight: typicalHeight) {
      return titlePageBlocks(from: lines, pageBounds: pageBounds, typicalHeight: typicalHeight)
    }

    var groups: [[ExtractedLine]] = []

    for (index, line) in lines.enumerated() {
      guard var currentGroup = groups.popLast(), let previousLine = currentGroup.last else {
        groups.append([line])
        continue
      }

      let verticalGap = previousLine.boundingBox.minY - line.boundingBox.maxY
      let nextLine = index + 1 < lines.count ? lines[index + 1] : nil
      let indentationThreshold = pageBounds.width * 0.012
      let startsIndentedParagraph =
        nextLine.map { line.boundingBox.minX > $0.boundingBox.minX + indentationThreshold } == true &&
        previousLine.text.last.map { ".!?".contains($0) } == true
      let startsNewBlock =
        verticalGap > typicalHeight * 0.72 ||
        startsIndentedParagraph ||
        isProminentHeading(previousLine, typicalHeight: typicalHeight) ||
        isProminentHeading(line, typicalHeight: typicalHeight)

      if startsNewBlock {
        groups.append(currentGroup)
        groups.append([line])
      } else {
        currentGroup.append(line)
        groups.append(currentGroup)
      }
    }

    return groups
      .flatMap(splitLongGroup)
      .prefix(400)
      .map { blockDictionary(from: $0, pageBounds: pageBounds, typicalHeight: typicalHeight) }
  }

  private func mergeLineFragments(_ lines: [ExtractedLine], pageBounds: CGRect) -> [ExtractedLine] {
    var mergedLines: [ExtractedLine] = []
    let maximumHorizontalGap = max(24, pageBounds.width * 0.08)

    for line in lines {
      guard let previousLine = mergedLines.last else {
        mergedLines.append(line)
        continue
      }

      let rowTolerance = max(previousLine.boundingBox.height, line.boundingBox.height) * 0.35
      let horizontalGap = line.boundingBox.minX - previousLine.boundingBox.maxX
      let isSameRow = abs(previousLine.boundingBox.midY - line.boundingBox.midY) <= rowTolerance

      if isSameRow && horizontalGap <= maximumHorizontalGap {
        mergedLines[mergedLines.count - 1] = ExtractedLine(
          boundingBox: previousLine.boundingBox.union(line.boundingBox),
          confidence: averagedConfidence(previousLine.confidence, line.confidence),
          text: joinLineFragments(previousLine.text, line.text)
        )
      } else {
        mergedLines.append(line)
      }
    }

    return mergedLines
  }

  private func contentsBlocks(from lines: [ExtractedLine], pageBounds: CGRect) -> [[String: Any]] {
    lines.map { line in
      let uppercaseText = line.text.uppercased()
      let blockKind: String

      if uppercaseText == "CONTENTS" {
        blockKind = "sectionHeading"
      } else if uppercaseText.range(of: #"^CHAPTER\s+\d+"#, options: .regularExpression) != nil {
        blockKind = "subheading"
      } else {
        blockKind = "listItem"
      }

      return blockDictionary(from: [line], pageBounds: pageBounds, blockKind: blockKind)
    }
  }

  private func titlePageBlocks(
    from lines: [ExtractedLine],
    pageBounds: CGRect,
    typicalHeight: CGFloat
  ) -> [[String: Any]] {
    var titleLineCount = 1

    while titleLineCount < lines.count {
      let previousLine = lines[titleLineCount - 1]
      let line = lines[titleLineCount]
      let verticalGap = previousLine.boundingBox.minY - line.boundingBox.maxY

      if verticalGap > typicalHeight * 1.25 {
        break
      }

      titleLineCount += 1
    }

    var blocks: [[String: Any]] = [
      blockDictionary(from: [lines[0]], pageBounds: pageBounds, blockKind: "chapterTitle")
    ]

    if titleLineCount > 1 {
      blocks.append(
        blockDictionary(
          from: Array(lines[1..<titleLineCount]),
          pageBounds: pageBounds,
          blockKind: "subheading"
        )
      )
    }

    for line in lines.dropFirst(titleLineCount) {
      blocks.append(blockDictionary(from: [line], pageBounds: pageBounds, blockKind: "subheading"))
    }

    return blocks
  }

  private func splitLongGroup(_ group: [ExtractedLine]) -> [[ExtractedLine]] {
    let maximumBlockCharacters = 2_400
    var chunks: [[ExtractedLine]] = []
    var currentChunk: [ExtractedLine] = []
    var currentCharacters = 0

    for line in group {
      if !currentChunk.isEmpty && currentCharacters + line.text.count > maximumBlockCharacters {
        chunks.append(currentChunk)
        currentChunk = []
        currentCharacters = 0
      }

      currentChunk.append(line)
      currentCharacters += line.text.count + 1
    }

    if !currentChunk.isEmpty {
      chunks.append(currentChunk)
    }

    return chunks
  }

  private func blockDictionary(
    from group: [ExtractedLine],
    pageBounds: CGRect,
    typicalHeight: CGFloat
  ) -> [String: Any] {
    let firstLine = group[0]
    let blockKind = group.count == 1 && isProminentHeading(firstLine, typicalHeight: typicalHeight)
      ? "sectionHeading"
      : group.count == 1 && firstLine.boundingBox.height >= typicalHeight * 1.15
        ? "subheading"
        : "body"
    return blockDictionary(from: group, pageBounds: pageBounds, blockKind: blockKind)
  }

  private func blockDictionary(
    from group: [ExtractedLine],
    pageBounds: CGRect,
    blockKind: String
  ) -> [String: Any] {
    let text = group.reduce(into: "") { result, line in
      if result.isEmpty {
        result = line.text
      } else if result.hasSuffix("-") {
        result += line.text
      } else {
        result += " " + line.text
      }
    }
    let bounds = group.dropFirst().reduce(group[0].boundingBox) { partial, line in
      partial.union(line.boundingBox)
    }
    let confidenceValues = group.compactMap(\.confidence)
    var dictionary: [String: Any] = [
      "blockKind": blockKind,
      "boundingBox": normalizedBoundingBox(bounds, pageBounds: pageBounds),
      "text": text,
    ]

    if !confidenceValues.isEmpty {
      dictionary["confidence"] = confidenceValues.reduce(0, +) / Double(confidenceValues.count)
    }

    return dictionary
  }

  private func normalizedBoundingBox(_ bounds: CGRect, pageBounds: CGRect) -> [String: Any] {
    let x = (bounds.minX - pageBounds.minX) / pageBounds.width
    let y = 1 - ((bounds.maxY - pageBounds.minY) / pageBounds.height)

    return [
      "height": clamped(bounds.height / pageBounds.height),
      "unit": "ratio",
      "width": clamped(bounds.width / pageBounds.width),
      "x": clamped(x),
      "y": clamped(y),
    ]
  }

  private func outlineEntries(from document: PDFDocument) -> [[String: Any]] {
    guard let root = document.outlineRoot else {
      return []
    }

    var entries: [[String: Any]] = []
    collectOutlineEntries(root, document: document, entries: &entries)
    return Array(entries.prefix(500))
  }

  private func collectOutlineEntries(
    _ outline: PDFOutline,
    document: PDFDocument,
    entries: inout [[String: Any]]
  ) {
    if let label = outline.label.map(normalizedText), !label.isEmpty,
       let page = outlinePage(outline) {
      let pageIndex = document.index(for: page)

      if pageIndex != NSNotFound {
        entries.append(["pageIndex": pageIndex, "title": label])
      }
    }

    for childIndex in 0..<outline.numberOfChildren {
      if let child = outline.child(at: childIndex) {
        collectOutlineEntries(child, document: document, entries: &entries)
      }
    }
  }

  private func outlinePage(_ outline: PDFOutline) -> PDFPage? {
    if let page = outline.destination?.page {
      return page
    }

    return (outline.action as? PDFActionGoTo)?.destination.page
  }

  private func isProminentHeading(_ line: ExtractedLine, typicalHeight: CGFloat) -> Bool {
    let wordCount = line.text.split(whereSeparator: { $0.isWhitespace }).count
    return line.text.count <= 140 && wordCount <= 16 && line.boundingBox.height >= typicalHeight * 1.32
  }

  private func isContentsPage(_ lines: [ExtractedLine]) -> Bool {
    guard lines.count >= 10 else {
      return false
    }

    let uppercaseLineCount = lines.filter(isUppercaseLine).count
    return Double(uppercaseLineCount) / Double(lines.count) >= 0.75
  }

  private func isTitlePage(_ lines: [ExtractedLine], typicalHeight: CGFloat) -> Bool {
    guard (3...10).contains(lines.count) else {
      return false
    }

    let uppercaseLineCount = lines.filter(isUppercaseLine).count
    let hasLargeVerticalGap = zip(lines, lines.dropFirst()).contains { previousLine, line in
      previousLine.boundingBox.minY - line.boundingBox.maxY > typicalHeight * 1.5
    }
    return Double(uppercaseLineCount) / Double(lines.count) >= 0.6 && hasLargeVerticalGap
  }

  private func isUppercaseLine(_ line: ExtractedLine) -> Bool {
    let letters = line.text.filter(\.isLetter)
    return !letters.isEmpty && letters.uppercased() == letters
  }

  private func isDecorativeCoverPage(_ lines: [ExtractedLine]) -> Bool {
    guard lines.count >= 12 else {
      return false
    }

    let uppercaseRatio = Double(lines.filter(isUppercaseLine).count) / Double(lines.count)
    let hasWideTitle = lines.contains {
      $0.boundingBox.width > 0.65 || $0.boundingBox.height > 0.06
    }
    let hasMultipleColumns =
      lines.contains { $0.boundingBox.minX < 0.2 } &&
      lines.contains { $0.boundingBox.minX > 0.45 }
    return uppercaseRatio >= 0.7 && hasWideTitle && hasMultipleColumns
  }

  private func isPublisherPromoPage(_ lines: [ExtractedLine]) -> Bool {
    let text = lines.map(\.text).joined(separator: " ").lowercased()
    return text.contains("thank you for downloading") &&
      (text.contains("mailing list") || text.contains("click here to sign up"))
  }

  private func joinLineFragments(_ firstText: String, _ secondText: String) -> String {
    let punctuationWithoutLeadingSpace = ",.;:!?%”’)]}"
    let openingPunctuation = "“‘([{"
    let needsSpace =
      secondText.first.map { !punctuationWithoutLeadingSpace.contains($0) } != false &&
      firstText.last.map { !openingPunctuation.contains($0) } != false
    return firstText + (needsSpace ? " " : "") + secondText
  }

  private func averagedConfidence(_ first: Double?, _ second: Double?) -> Double? {
    let values = [first, second].compactMap { $0 }
    return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
  }

  private func isLikelyPageNumber(_ line: ExtractedLine, pageBounds: CGRect) -> Bool {
    let text = normalizedText(line.text)
    let nearPageEdge =
      line.boundingBox.minY < pageBounds.minY + pageBounds.height * 0.08 ||
      line.boundingBox.maxY > pageBounds.maxY - pageBounds.height * 0.08 ||
      line.boundingBox.minX > pageBounds.minX + pageBounds.width * 0.65
    return text.count <= 4 && text.allSatisfy(\.isNumber) && nearPageEdge
  }

  private func normalizedText(_ text: String) -> String {
    text
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func median(_ values: [CGFloat]) -> CGFloat {
    let sortedValues = values.sorted()
    let middle = sortedValues.count / 2

    if sortedValues.count.isMultiple(of: 2) {
      return (sortedValues[middle - 1] + sortedValues[middle]) / 2
    }

    return sortedValues[middle]
  }

  private func clamped(_ value: CGFloat) -> CGFloat {
    min(1, max(0, value))
  }

  private func moduleError(_ code: Int, _ message: String) -> NSError {
    NSError(
      domain: "ApplePDFImport",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
