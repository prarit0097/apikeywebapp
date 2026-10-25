import type {Store} from './store.js';
export type AppConfig={store:Store;origin:string;encryptionKey:Buffer;bootstrapToken:string;production:boolean;providerFetch?:any};
