import { BaseNode, TBaseNodeOptions } from "./base-node";

type TNodeFactory = (options: TBaseNodeOptions) => BaseNode;

type TNodeRegistryOptions = {
  // Future options can be added here
};

export class NodeRegistry {
  private nodesFactory: Map<string, (options: TBaseNodeOptions) => BaseNode>;

  constructor(options?: TNodeRegistryOptions) {
    this.nodesFactory = new Map<
      string,
      (options: TBaseNodeOptions) => BaseNode
    >();
  }

  public registerNode(
    name: string,
    factory: (options: TBaseNodeOptions<any>) => BaseNode
  ): void {
    if (this.nodesFactory.has(name)) {
      throw new Error(`Node "${name}" is already registered.`);
    }

    this.nodesFactory.set(name, factory);
  }

  public unregisterNode(name: string): void {
    this.nodesFactory.delete(name);
  }

  public clearRegistry(): void {
    this.nodesFactory.clear();
  }

  public getNodeFactory(name: string): TNodeFactory {
    const factory = this.nodesFactory.get(name);
    if (!factory) {
      throw new Error(`Node "${name}" is not registered.`);
    }
    return factory;
  }

  public hasNode(name: string): boolean {
    return this.nodesFactory.has(name);
  }

  public getRegisteredNodeNames(): string[] {
    return Array.from(this.nodesFactory.keys());
  }
}

export const registry = new NodeRegistry();
