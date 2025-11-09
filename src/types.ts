export type TNodeData = {
  name: string;
  label: string;
  inputs: Array<{ id: string; label?: string }>;
  outputs: Array<{ id: string; label?: string; expose?: boolean }>;
  defaultOutput: unknown;
  config: Record<string, unknown>;
};

export type TNode = {
  id: string;
  type: "trigger" | "processor" | "action" | "agent" | "tool";
  data: TNodeData;
};

export type TConnection = {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
};

export type TGraph = {
  id: string;
  name: string;
  description?: string;
  nodes: TNode[];
  connections: TConnection[];
};

export interface TExternalResources {
  // Uncomment the line below if you want to let users define resources with any key. Leaving it commented enforces strict typing for only declared properties.
  // [key: string]: unknown;
}

export type TNodeEvent = unknown;

export type WorkflowEvent = {
  nodeId: string;
  outputId: string;
  event: TNodeEvent;
  timestamp: number;
};

export type TEngineContext = {
  externalResources: TExternalResources;
};
