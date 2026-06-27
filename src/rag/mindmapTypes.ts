export type MindMapNodeType = "theme" | "concept" | "argument" | "character";

export interface MindMapNode {
  id: string;
  label: string;
  type: MindMapNodeType;
  summary: string;
  importance: number;  // 0.0–1.0
  passage_ids: string[];
  chapter: number | null;
}

export interface MindMapEdge {
  from: string;
  to: string;
  label: string;
}

export interface MindMapChapter {
  index: number;
  id: string;
  title: string | null;
  summary: string | null;
  jump_paragraph_id: string | null;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export interface MindMapData {
  genre: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  chapters?: MindMapChapter[];
}

export type MindMapStatus = "pending" | "generating" | "ready" | "failed" | "insufficient_content";

export interface MindMapResponse {
  status: MindMapStatus;
  data?: MindMapData;
  error?: string;
}
