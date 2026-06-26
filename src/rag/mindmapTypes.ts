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

export interface MindMapData {
  genre: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export type MindMapStatus = "pending" | "generating" | "ready" | "failed" | "insufficient_content";

export interface MindMapResponse {
  status: MindMapStatus;
  data?: MindMapData;
  error?: string;
}
