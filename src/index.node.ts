import { registerAdapter } from './adapters/registry';
import { httpAdapter } from './adapters/http';
import grab from './index';

// Register Node http transport
registerAdapter('http', httpAdapter);

export * from './index';
export { httpAdapter } from './adapters/http';

// Agent-safety features (Node-only, requires fs/os/path)
export * from './agent';

export default grab;
