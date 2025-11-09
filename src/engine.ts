import { delay, filter, map, Observable, Subject } from "rxjs";
import { NodeRegistry } from "./node-registry";
import { TExternalResources, TGraph, TNodeEvent } from "./types";
import { BaseNode } from "./base-node";

type WorkflowEngineOptions = {
  externalResources: TExternalResources;
  registry: NodeRegistry;
};

type TGraphStatus =
  | "starting"
  | "started"
  | "stopped"
  | "error"
  | "paused"
  | "resumed";

type WorkflowStatusEvent = {
  graphId: string;
  time: number;
  status: TGraphStatus;
  error?: string;
};

type TWorkflowResource = {
  status: TGraphStatus;
  subject: Subject<{
    nodeId: string;
    outputId: string;
    event: TNodeEvent;
    time: number;
  }>;
  error?: string;
  nodeInstances: Array<BaseNode>;
  nodesSubjects: Array<Subject<TNodeEvent>>;
  pausedEvents: Array<{
    nodeId: string;
    outputId: string;
    event: TNodeEvent;
    time: number;
  }>;
};

type TPinNodeOptions = {
  graphId: string;
  nodeId: string;
  data?: unknown;
};

type TUnpinNodeOptions = {
  graphId: string;
  nodeId: string;
};

export interface IWorkflowEngine {
  run(graph: TGraph): void;
  stop(graphId: string): void;
  pinNode(options: TPinNodeOptions): void;
  unpinNode(options: TUnpinNodeOptions): void;
  pause(graphId: string): void;
  resume(graphId: string): void;
}
export class WorkflowEngine implements IWorkflowEngine {
  private externalResources: TExternalResources;
  private registry: NodeRegistry;
  private workflowResources: Map<string, TWorkflowResource> = new Map();
  private workflowStatusSubject: Subject<WorkflowStatusEvent>;

  constructor(options: WorkflowEngineOptions) {
    this.externalResources = options.externalResources;
    this.registry = options.registry;
    this.workflowStatusSubject = new Subject<WorkflowStatusEvent>();
  }

  public run(graph: TGraph): void {
    const workflowResource: TWorkflowResource = new Proxy(
      {
        status: "starting",
        nodeInstances: [],
        nodesSubjects: [],
        subject: new Subject<{
          nodeId: string;
          outputId: string;
          event: TNodeEvent;
          time: number;
        }>(),
        pausedEvents: [],
      } as TWorkflowResource,
      {
        set: (target, prop, value) => {
          if (prop === "status") {
            const event: WorkflowStatusEvent = {
              graphId: graph.id,
              time: Date.now(),
              status: value as TGraphStatus,
            };
            if (value === "error") {
              event.error = target.error || "Workflow entered error state.";
            }
            this.workflowStatusSubject.next(event);
          }
          // Set the property on the target object
          target[prop as keyof TWorkflowResource] = value;
          return true;
        },
      }
    );
    this.workflowResources.set(graph.id, workflowResource);
    this.setupNodes(graph, workflowResource);
  }

  private async setupNodes(graph: TGraph, resources: TWorkflowResource) {
    try {
      const setupResults = await Promise.all(
        graph.nodes.map((node) => this.setupNode(graph, node.id, resources))
      );
      const errors = setupResults.filter(
        (result): result is { error: string } => "error" in result
      );
      if (errors.length === 0) {
        // run nodes
        resources.nodeInstances.forEach((node) => node.run());
        resources.status = "started";
      } else {
        const errorMessages = errors.map((e) => e.error).join("; ");
        resources.status = "error";
        Object.assign(resources, { error: errorMessages });
      }
    } catch (error) {
      let errorMessage = "Unknown error during node setup.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      Object.assign(resources, { error: errorMessage, status: "error" });
    }
  }

  private async setupNode(
    graph: TGraph,
    nodeId: string,
    resources: TWorkflowResource
  ) {
    const nodeDef = graph.nodes.find((n) => n.id === nodeId);
    if (!nodeDef) {
      throw new Error(`Node with ID ${nodeId} not found in graph ${graph.id}`);
    }
    const inputs: Record<string, Observable<TNodeEvent>> = {};
    const outputs: Record<string, Subject<TNodeEvent>> = {};
    const config = nodeDef.data.config;

    const nodeFactory = this.registry.getFactory(nodeDef.data.name);

    // prepare inputs
    const incomingConnections = graph.connections.filter(
      (conn) => conn.target === nodeId
    );
    for (const conn of incomingConnections) {
      const observable = resources.subject.asObservable().pipe(
        filter(
          (ev) => ev.nodeId === conn.source && ev.outputId === conn.sourceHandle
        ),
        map((e) => e.event),
        delay(100)
      );

      if (inputs[conn.targetHandle]) {
        inputs[conn.targetHandle] = new Observable<TNodeEvent>((subscriber) => {
          inputs[conn.targetHandle].subscribe(subscriber);
          observable.subscribe(subscriber);
        });
      } else {
        inputs[conn.targetHandle] = observable;
      }
    }

    // prepare outputs
    nodeDef.data.outputs.forEach((output) => {
      const subject = new Subject<TNodeEvent>();
      outputs[output.id] = subject;

      resources.nodesSubjects.push(subject);

      // Relay output events to the workflow subject
      subject.subscribe((event) => {
        if (resources.status === "paused") {
          resources.pausedEvents.push({
            nodeId,
            outputId: output.id,
            event,
            time: Date.now(),
          });
          return;
        }
        resources.subject.next({
          nodeId,
          outputId: output.id,
          event,
          time: Date.now(),
        });
      });
    });

    const nodeInstance = nodeFactory({
      id: nodeId,
      config,
      inputs,
      outputs,
      engineContext: {
        externalResources: this.externalResources,
      },
    });
    resources.nodeInstances.push(nodeInstance);
    try {
      await nodeInstance.setup();
      return { success: true };
    } catch (error) {
      if (error instanceof Error) return { error: error.message };

      return { error: "Unknown error during node setup." };
    }
  }

  public stop(graphId: string): void {
    const resources = this.getResource(graphId);
    if (!resources) return;
    this.cleanupGraphResources(graphId).then(() => {
      resources.status = "stopped";
    });
  }

  public pinNode(options: TPinNodeOptions): void {
    const { graphId, nodeId, data } = options;
    const resources = this.getResource(graphId);
    if (!resources) return;
    const nodeInstance = resources.nodeInstances.find(
      (node) => node["id"] === nodeId
    );
    if (!nodeInstance) {
      this.workflowStatusSubject.next({
        graphId,
        time: Date.now(),
        status: "error",
        error: `Node with ID ${nodeId} not found in graph ${graphId}.`,
      });
      return;
    }
    nodeInstance.pin(data);
  }

  public unpinNode(options: TUnpinNodeOptions): void {
    const { graphId, nodeId } = options;
    const resources = this.getResource(graphId);
    if (!resources) return;
    const nodeInstance = resources.nodeInstances.find(
      (node) => node["id"] === nodeId
    );
    if (!nodeInstance) {
      this.workflowStatusSubject.next({
        graphId,
        time: Date.now(),
        status: "error",
        error: `Node with ID ${nodeId} not found in graph ${graphId}.`,
      });
      return;
    }
    nodeInstance.unpin();
  }

  private async cleanupGraphResources(graphId: string): Promise<void> {
    const resources = this.workflowResources.get(graphId);
    if (!resources) return;
    const { nodeInstances, nodesSubjects } = resources;
    // Complete all node subjects (not necessary, but good practice)
    nodesSubjects.forEach((subject) => subject.complete());
    // Clear node instances
    resources.nodeInstances = [];

    // Stop all node instances
    await Promise.all(nodeInstances.map((node) => node.stop()));

    // Remove graph resources from the map
    this.workflowResources.delete(graphId);
  }

  public getWorkflowsStatusObservable() {
    return this.workflowStatusSubject.asObservable();
  }

  public isGraphActive(graphId: string): boolean {
    return this.workflowResources.has(graphId);
  }

  public getWorkflowExecutionObservable(graphId: string) {
    const resources = this.workflowResources.get(graphId);
    if (!resources) {
      throw new Error(`Graph with ID ${graphId} is not running.`);
    }
    return resources.subject.asObservable();
  }

  public pause(graphId: string): void {
    const resources = this.getResource(graphId);
    if (!resources) return;
    resources.nodeInstances.forEach((node) => node.pause());
    resources.status = "paused";
  }

  public resume(graphId: string): void {
    const resources = this.getResource(graphId);
    if (!resources) return;

    resources.nodeInstances.forEach((node) => node.resume());
    resources.status = "resumed";
    // Process paused events
    resources.pausedEvents.forEach((pausedEvent) => {
      resources.subject.next({
        nodeId: pausedEvent.nodeId,
        outputId: pausedEvent.outputId,
        event: pausedEvent.event,
        time: pausedEvent.time,
      });
    });
    // Clear paused events
    resources.pausedEvents = [];
  }

  private getResource(graphId: string): TWorkflowResource | undefined {
    const resources = this.workflowResources.get(graphId);
    if (!resources) {
      this.workflowStatusSubject.next({
        graphId,
        time: Date.now(),
        status: "error",
        error: `Graph with ID ${graphId} is not running.`,
      });
      return undefined;
    }
    return resources;
  }
}
