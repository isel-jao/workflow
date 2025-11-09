import { Observable, Subject, Subscription } from "rxjs";
import { TEngineContext, TNodeEvent } from "./types";

export type TBaseNodeOptions<
  T extends Record<string, unknown> = Record<string, unknown>
> = {
  id: string;
  config: T;
  inputs: Record<string, Observable<TNodeEvent>>;
  outputs: Record<string, Subject<TNodeEvent>>;
  engineContext: TEngineContext;
};

export abstract class BaseNode<
  T extends Record<string, unknown> = Record<string, unknown>
> {
  protected id: string;
  protected config: T;
  protected inputs: Record<string, Observable<TNodeEvent>>;
  protected outputs: Record<string, Subject<TNodeEvent>>;
  protected engineContext: TEngineContext;
  protected subscriptions: Array<Subscription> = [];
  protected isPinned: boolean = false;
  protected lastResult: unknown = null;

  constructor(options: TBaseNodeOptions<T>) {
    this.id = options.id;
    this.config = options.config;
    this.inputs = options.inputs;
    this.outputs = options.outputs;
    this.engineContext = options.engineContext;
  }

  public async setup(): Promise<void> {
    // Optional setup logic for the node
  }

  public run(): void {
    const inputSubject = this.inputs["input"];

    const subscription = inputSubject?.subscribe({
      next: async (data) => {
        try {
          if (this.isPinned) {
            this.outputs["success"]?.next(this.lastResult);
            return;
          }
          const result = await this.handleTick(data);
          this.outputs["success"]?.next(result);

          // const result = await this.execute();
        } catch (error) {
          this.outputs["error"]?.next(error);
        }
      },
    });
    if (subscription) this.subscriptions.push(subscription);
  }

  protected async handleTick(data: unknown): Promise<unknown> {
    // to be overridden by subclasses
    return data;
  }

  public pin(data?: unknown): void {
    this.isPinned = true;
    if (data !== undefined) {
      this.lastResult = data;
    }
  }

  public unpin(): void {
    this.isPinned = false;
  }

  public async stop(): Promise<void> {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
    // Additional cleanup logic if needed
  }

  public pause(): void {
    //  implement pause logic for trigger nodes
  }

  public resume(): void {
    //  implement resume logic for trigger nodes
  }
}
