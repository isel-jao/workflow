import { delay, filter, map, Observable, Subject } from "rxjs";
import { NodeRegistry } from "./node-registry";
import { TExternalResources, TGraph, TNodeEvent } from "./types";
import { BaseNode } from "./base-node";

type WorkflowEngineOptions = {
  externalResources: TExternalResources;
  registry: NodeRegistry;
};

type TGraphStatus = "starting" | "started" | "stopped" | "error";

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
  nodeInstances: Array<BaseNode>;
  nodesSubjects: Array<Subject<TNodeEvent>>;
};

export interface IWorkflowEngine {
  run(graph: TGraph): void;
  stop(graphId: string): void;
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
    const workflowResource: TWorkflowResource = {
      status: "starting",
      nodeInstances: [],
      nodesSubjects: [],
      subject: new Subject<{
        nodeId: string;
        outputId: string;
        event: TNodeEvent;
        time: number;
      }>(),
    };
    this.workflowResources.set(graph.id, workflowResource);
    this.workflowStatusSubject.next({
      graphId: graph.id,
      time: Date.now(),
      status: "starting",
    });
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
        this.workflowStatusSubject.next({
          graphId: graph.id,
          time: Date.now(),
          status: "started",
        });
      } else {
        const errorMessages = errors.map((e) => e.error).join("; ");
        resources.status = "error";
        this.workflowStatusSubject.next({
          graphId: graph.id,
          time: Date.now(),
          status: "error",
          error: errorMessages,
        });
      }
    } catch (error) {
      resources.status = "error";
      let errorMessage = "Unknown error during node setup.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.workflowStatusSubject.next({
        graphId: graph.id,
        time: Date.now(),
        status: "error",
        error: errorMessage,
      });
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
    const resources = this.workflowResources.get(graphId);
    if (!resources) {
      this.workflowStatusSubject.next({
        graphId,
        time: Date.now(),
        status: "error",
        error: `Graph with ID ${graphId} is not running.`,
      });
      return;
    }
    this.cleanupGraphResources(graphId).then(() => {
      this.workflowStatusSubject.next({
        graphId,
        time: Date.now(),
        status: "stopped",
      });
    });
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
}

// import { TGraph, WorkflowEvent, TNodeEvent, TLogger } from "./types";
// import { delay, filter, mergeAll, Observable, of, Subject } from "rxjs";
// import { BaseNode, ExternalResources } from ".";
// import { NodeRegistry } from "./node-registry";

// export interface IWorkflowEngine {
//   start(graph: TGraph): Promise<void>;
//   pause(graphId: string): Promise<void>;
//   resume(graphId: string): Promise<void>;
//   stop(graphId: string): Promise<void>;
//   pinNode(graphId: string, nodeId: string): Promise<void>;
//   unpinNode(graphId: string, nodeId: string): Promise<void>;
// }

// type WorkflowEngineOptions = {
//   externalResources?: ExternalResources;
//   registry: NodeRegistry;
//   logger?: TLogger;
// };

// type GraphResource = {
//   subject: Subject<WorkflowEvent>;
//   status: "starting" | "started" | "paused" | "resumed";
//   nodeInstances: BaseNode[];
//   nodesSubjects: Array<Subject<TNodeEvent>>;
// };

// export class WorkflowEngine implements IWorkflowEngine {
//   private externalResources: ExternalResources;
//   private graphResources: Map<string, GraphResource> = new Map<
//     string,
//     GraphResource
//   >();
//   private logger: TLogger;
//   private registry: NodeRegistry;
//   private workflowStatusEvents: Subject<{
//     graphId: string;
//     time: number;
//     status: "starting" | "started" | "paused" | "resumed" | "stopped" | "error";
//     error?: string;
//   }> = new Subject();

//   constructor(options: WorkflowEngineOptions) {
//     this.externalResources = options.externalResources || {};
//     this.registry = options.registry;
//     this.logger = options.logger || console;
//     this.logger.info(`WorkflowEngine initialized.`);
//   }

//   public async start(graph: TGraph): Promise<void> {
//     const graphResource: GraphResource = {
//       subject: new Subject<WorkflowEvent>(),
//       status: "starting",
//       nodeInstances: [],
//       nodesSubjects: [],
//     };
//     this.graphResources.set(graph.id, graphResource);

//     const preparationSuccess = await this.prepareNodes(graph, graphResource);
//   }

//   private async prepareNodes(
//     graph: TGraph,
//     resources: GraphResource
//   ): Promise<boolean> {
//     for (const nodeDef of graph.nodes) {
//       const prepareResult = await this.prepareNode({
//         resources,
//         graph,
//         nodeId: nodeDef.id,
//       });
//       if ("error" in prepareResult) {
//         this.logger.error(
//           `Error preparing node ${nodeDef.id} in graph ${graph.id}: ${prepareResult.error}`
//         );
//         return false;
//       }
//     }
//     return true;
//   }

//   private async prepareNode(options: {
//     resources: GraphResource;
//     graph: TGraph;
//     nodeId: string;
//   }) {
//     const { graph, nodeId, resources } = options;
//     const nodeDef = options.graph.nodes.find((n) => n.id === options.nodeId);

//     if (!nodeDef)
//       return {
//         error: `Node with ID ${nodeId} not found in graph ${graph.id}`,
//       };

//     const nodeFactory = this.registry.getNodeFactory(nodeDef.type);
//     if (!nodeFactory)
//       throw new Error(`Node factory for type ${nodeDef.type} not found`);

//     const inputs: Record<string, Observable<TNodeEvent>> = {};

//     const incomingConnections = graph.connections.filter(
//       (conn) => conn.target === nodeId
//     );

//     // Set up input observables based on incoming connections
//     for (const conn of incomingConnections) {
//       const observable = resources.subject.asObservable().pipe(
//         filter(
//           (ev) => ev.nodeId === conn.source && ev.outputId === conn.sourceHandle
//         ),
//         delay(100)
//       );

//       if (inputs[conn.targetHandle]) {
//         // If there are multiple connections to the same input, merge them
//         inputs[conn.targetHandle] = of(
//           inputs[conn.targetHandle],
//           observable
//         ).pipe(mergeAll());
//       } else inputs[conn.targetHandle] = observable;
//     }

//     const outputs: Record<string, Subject<TNodeEvent>> = {};

//     nodeDef.data.outputs.forEach((output) => {
//       const subject = new Subject<TNodeEvent>();
//       outputs[output.id] = subject;
//       resources.nodesSubjects.push(subject);
//     });

//     const config = graph.nodes.find((n) => n.id === nodeId)?.data.config || {};

//     const nodeInstance = nodeFactory({
//       id: nodeId,
//       config,
//       inputs,
//       outputs,
//       engineContext: {
//         externalResources: this.externalResources,
//         logger: this.logger,
//       },
//     });
//     resources.nodeInstances.push(nodeInstance);

//     return {
//       success: true,
//     };
//   }

//   public async pause(graphId: string): Promise<void> {
//     throw new Error("Method not implemented.");
//   }

//   public async resume(graphId: string): Promise<void> {
//     throw new Error("Method not implemented.");
//   }

//   public async stop(graphId: string): Promise<void> {
//     const resources = this.graphResources.get(graphId);
//     if (!resources) {
//       throw new Error(`Graph with ID ${graphId} is not running.`);
//     }
//     const { nodeInstances } = resources;
//     // stop all node instances
//     await Promise.all(nodeInstances.map((node) => node.stop()));
//     // cleanup resources
//     await this.cleanupGraphResources(graphId);
//     this.logger.info(`Stopped graph with ID: ${graphId}`);
//     this.workflowStatusEvents.next({
//       graphId,
//       status: "stopped",
//       time: Date.now(),
//     });
//   }

//   private async cleanupGraphResources(graphId: string): Promise<void> {
//     const resources = this.graphResources.get(graphId);
//     if (!resources) return;
//     const { nodeInstances, nodesSubjects } = resources;
//     // Complete all node subjects (not necessary, but good practice)
//     nodesSubjects.forEach((subject) => subject.complete());
//     // Clear node instances
//     resources.nodeInstances = [];
//     // Remove graph resources from the map
//     this.graphResources.delete(graphId);
//   }

//   public async pinNode(graphId: string, nodeId: string): Promise<void> {
//     throw new Error("Method not implemented.");
//   }

//   public async unpinNode(graphId: string, nodeId: string): Promise<void> {
//     throw new Error("Method not implemented.");
//   }
// }

// type CreateWorkflowEngineOptions = WorkflowEngineOptions & {
//   multiThreading?: {
//     enabled: boolean;
//     maxThreads?: number;
//   };
// };

// export function createWorkflowEngine(
//   options: CreateWorkflowEngineOptions
// ): IWorkflowEngine {
//   return new WorkflowEngine(options);
// }
