import ExpoModulesCore
import Foundation
import ImageIO
import UIKit
import Vision

public final class AppleVisionOCRModule: Module {
  private struct RecognizedLine {
    let boundingBox: CGRect
    let confidence: Float
    let text: String
  }

  public func definition() -> ModuleDefinition {
    Name("AppleVisionOCR")

    AsyncFunction("recognizeText") { (imageUri: String) throws -> [String: Any] in
      let image = try self.loadImage(imageUri)
      let lines = try self.recognizeLines(in: image)
      let blocks = self.groupLinesIntoBlocks(lines)
      let text = blocks.compactMap { $0["text"] as? String }.joined(separator: "\n\n")

      return [
        "author": "Scanned page",
        "blocks": blocks,
        "language": NSNull(),
        "text": text,
        "title": self.inferTitle(from: blocks),
      ]
    }
  }

  private func loadImage(_ imageUri: String) throws -> UIImage {
    let url: URL

    if let parsedUrl = URL(string: imageUri), parsedUrl.scheme != nil {
      url = parsedUrl
    } else {
      url = URL(fileURLWithPath: imageUri)
    }

    let data = try Data(contentsOf: url)

    guard let image = UIImage(data: data), image.cgImage != nil else {
      throw NSError(
        domain: "AppleVisionOCR",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "The captured image could not be opened for on-device OCR."]
      )
    }

    return image
  }

  private func recognizeLines(in image: UIImage) throws -> [RecognizedLine] {
    guard let cgImage = image.cgImage else {
      return []
    }

    var requestError: Error?
    var lines: [RecognizedLine] = []
    let request = VNRecognizeTextRequest { request, error in
      if let error {
        requestError = error
        return
      }

      lines = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else {
          return nil
        }

        return RecognizedLine(
          boundingBox: observation.boundingBox,
          confidence: candidate.confidence,
          text: candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        )
      }.filter { !$0.text.isEmpty }
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.007

    if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = true
    }

    let handler = VNImageRequestHandler(
      cgImage: cgImage,
      orientation: image.imageOrientation.cgImageOrientation,
      options: [:]
    )
    try handler.perform([request])

    if let requestError {
      throw requestError
    }

    // Vision returns text observations in reading order. Re-sorting by geometry
    // breaks that order on photographed pages with perspective or rotation.
    return lines.filter { !isLikelyPageNumber($0) }
  }

  private func groupLinesIntoBlocks(_ lines: [RecognizedLine]) -> [[String: Any]] {
    guard !lines.isEmpty else {
      return []
    }

    let typicalHeight = median(lines.map { $0.boundingBox.height })
    var groups: [[RecognizedLine]] = []

    for (index, line) in lines.enumerated() {
      guard var currentGroup = groups.popLast(), let previousLine = currentGroup.last else {
        groups.append([line])
        continue
      }

      let verticalGap = previousLine.boundingBox.minY - line.boundingBox.maxY
      let nextLine = index + 1 < lines.count ? lines[index + 1] : nil
      let startsIndentedParagraph =
        nextLine.map { line.boundingBox.minX > $0.boundingBox.minX + 0.012 } == true &&
        previousLine.text.last.map { ".!?".contains($0) } == true
      let startsNewBlock =
        verticalGap > typicalHeight * 0.72 ||
        startsIndentedParagraph ||
        isHeading(previousLine) ||
        isHeading(line)

      if startsNewBlock {
        groups.append(currentGroup)
        groups.append([line])
      } else {
        currentGroup.append(line)
        groups.append(currentGroup)
      }
    }

    return groups.prefix(80).map { group in
      let text = group.reduce(into: "") { result, line in
        if result.isEmpty {
          result = line.text
        } else if result.hasSuffix("-") {
          result += line.text
        } else {
          result += " " + line.text
        }
      }
      let confidence = group.map { Double($0.confidence) }.reduce(0, +) / Double(group.count)
      let boundingBox = group.dropFirst().reduce(group[0].boundingBox) { partial, line in
        partial.union(line.boundingBox)
      }

      return [
        "boundingBox": [
          "height": boundingBox.height,
          "unit": "ratio",
          "width": boundingBox.width,
          "x": boundingBox.minX,
          "y": 1 - boundingBox.maxY,
        ],
        "confidence": confidence,
        "text": text,
      ]
    }
  }

  private func inferTitle(from blocks: [[String: Any]]) -> String {
    for block in blocks.prefix(3) {
      guard let text = block["text"] as? String else {
        continue
      }

      let words = text.split(whereSeparator: { $0.isWhitespace })
      let letters = text.filter { $0.isLetter }

      if text.count <= 120 && words.count <= 12 && !letters.isEmpty && letters.uppercased() == letters {
        return text
      }
    }

    return "Scanned page"
  }

  private func isHeading(_ line: RecognizedLine) -> Bool {
    let letters = line.text.filter { $0.isLetter }
    let wordCount = line.text.split(whereSeparator: { $0.isWhitespace }).count
    return line.text.count <= 100 && wordCount <= 12 && !letters.isEmpty && letters.uppercased() == letters
  }

  private func isLikelyPageNumber(_ line: RecognizedLine) -> Bool {
    let trimmedText = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedText.count <= 4 &&
      trimmedText.allSatisfy(\.isNumber) &&
      (line.boundingBox.minX > 0.6 || line.boundingBox.maxY > 0.9)
  }

  private func median(_ values: [CGFloat]) -> CGFloat {
    let sortedValues = values.sorted()
    let middle = sortedValues.count / 2

    if sortedValues.count.isMultiple(of: 2) {
      return (sortedValues[middle - 1] + sortedValues[middle]) / 2
    }

    return sortedValues[middle]
  }
}

private extension UIImage.Orientation {
  var cgImageOrientation: CGImagePropertyOrientation {
    switch self {
    case .up:
      return .up
    case .upMirrored:
      return .upMirrored
    case .down:
      return .down
    case .downMirrored:
      return .downMirrored
    case .left:
      return .left
    case .leftMirrored:
      return .leftMirrored
    case .right:
      return .right
    case .rightMirrored:
      return .rightMirrored
    @unknown default:
      return .up
    }
  }
}
