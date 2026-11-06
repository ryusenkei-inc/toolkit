import { blobStoreContract } from './contract.ts';
import { memoryBlobStore } from './testing.ts';

blobStoreContract('memoryBlobStore', memoryBlobStore);
