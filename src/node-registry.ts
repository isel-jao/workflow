import { BaseNode, TBaseNodeOptions } from "./base-node";

type TNodeFactory<T extends BaseNode = BaseNode> = (
  options: TBaseNodeOptions<any>
) => T;

type TNodeConstructor<T extends BaseNode = BaseNode> = new (
  options: TBaseNodeOptions<any>
) => T;

export class NodeRegistry {
  private nodesFactory = new Map<string, TNodeFactory>();

  public add<T extends BaseNode>(
    name: string,
    NodeClass: TNodeConstructor<T>
  ): void {
    if (this.nodesFactory.has(name)) {
      throw new Error(`Node "${name}" is already registered.`);
    }

    this.nodesFactory.set(name, (options) => new NodeClass(options));
  }

  public set<T extends BaseNode>(
    name: string,
    NodeClass: TNodeConstructor<T>
  ): void {
    this.nodesFactory.set(name, (options) => new NodeClass(options));
  }

  public remove(name: string): void {
    this.nodesFactory.delete(name);
  }

  public clear(): void {
    this.nodesFactory.clear();
  }

  public getFactory(name: string): TNodeFactory {
    const factory = this.nodesFactory.get(name);
    if (!factory) throw new Error(`Node "${name}" is not registered.`);

    return factory;
  }

  public createNode<T extends BaseNode>(
    name: string,
    options: TBaseNodeOptions<any>
  ): T {
    const factory = this.getFactory(name);
    return factory(options) as T;
  }

  public has(name: string): boolean {
    return this.nodesFactory.has(name);
  }

  public getAllNames(): string[] {
    return [...this.nodesFactory.keys()];
  }
}

export const registry = new NodeRegistry();
