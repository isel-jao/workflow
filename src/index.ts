import { functionA, functionB } from "./moduleA";
import { ClassC } from "./moduleB";

export { functionA, functionB } from "./moduleA";
export { ClassC } from "./moduleB";
export type { MyType } from "./types";

// Default export (optional)
export default {
  functionA,
  functionB,
  ClassC,
};
