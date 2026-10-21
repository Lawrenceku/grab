import { registerAdapter } from './adapters/registry';
import { httpAdapter } from './adapters/http';
import grab from './index';

// Register Node http transport
registerAdapter('http', httpAdapter);

export * from './index';
export { httpAdapter } from './adapters/http';
export default grab;
