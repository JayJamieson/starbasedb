import { createResponse } from './utils';
import handleStudioRequest from "./studio";
import { Handler } from "./handler";
import { QueryResponse } from "./operation";
export { DatabaseDurableObject } from './do'; 

const DURABLE_OBJECT_ID = 'sql-durable-object';

export interface Env {
    AUTHORIZATION_TOKEN: string;
    DATABASE_DURABLE_OBJECT: DurableObjectNamespace;
    REGION: string;
  
    // Studio credentials
    STUDIO_USER?: string;
    STUDIO_PASS?: string;
  
    // External database source details
    EXTERNAL_DB_TYPE?: string;
    OUTERBASE_API_KEY?: string;
  
    // ## DO NOT REMOVE: TEMPLATE INTERFACE ##
}

export enum Source {
    internal = 'internal',  // Durable Object's SQLite instance
    external = 'external'   // External data source (e.g. Outerbase)
}

export type DataSource = {
    source: Source;
    request: Request;
    internalConnection?: InternalConnection;
    externalConnection?: {
        outerbaseApiKey: string;
    };
}

interface InternalConnection {
    durableObject: DatabaseStub;
}

type DatabaseStub = DurableObjectStub & {
    fetch: (init?: RequestInit | Request) => Promise<Response>;
    executeQuery(sql: string, params: any[] | undefined, isRaw: boolean): QueryResponse;
    executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean): any[];
};

enum RegionLocationHint {
    AUTO = 'auto',
    WNAM = 'wnam', // Western North America
    ENAM = 'enam', // Eastern North America
    SAM = 'sam', // South America
    WEUR = 'weur', // Western Europe
    EEUR = 'eeur', // Eastern Europe
    APAC = 'apac', // Asia Pacific
    OC = 'oc', // Oceania
    AFR = 'afr', // Africa
    ME = 'me', // Middle East
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const isWebSocket = request.headers.get("Upgrade") === "websocket";

        /**
         * If the request is a GET request to the /studio endpoint, we can handle the request
         * directly in the Worker to avoid the need to deploy a separate Worker for the Studio.
         * Studio provides a user interface to interact with the SQLite database in the Durable
         * Object.
         */
        if (env.STUDIO_USER && env.STUDIO_PASS && request.method === 'GET' && pathname === '/studio') {
            return handleStudioRequest(request, {
                username: env.STUDIO_USER,
                password: env.STUDIO_PASS, 
                apiToken: env.AUTHORIZATION_TOKEN
            });
        }

        /**
         * Prior to proceeding to the Durable Object, we can perform any necessary validation or
         * authorization checks here to ensure the request signature is valid and authorized to
         * interact with the Durable Object.
         */
        if (request.headers.get('Authorization') !== `Bearer ${env.AUTHORIZATION_TOKEN}` && !isWebSocket) {
            return createResponse(undefined, 'Unauthorized request', 401)
        } else if (isWebSocket) {
            /**
             * Web socket connections cannot pass in an Authorization header into their requests,
             * so we can use a query parameter to validate the connection.
             */
            const token = url.searchParams.get('token');

            if (token !== env.AUTHORIZATION_TOKEN) {
                return new Response('WebSocket connections are not supported at this endpoint.', { status: 440 });
            }
        }

        /**
         * Retrieve the Durable Object identifier from the environment bindings and instantiate a
         * Durable Object stub to interact with the Durable Object.
         */
        const region = env.REGION ?? RegionLocationHint.AUTO;
        const id: DurableObjectId = env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
        const stub = region !== RegionLocationHint.AUTO ? env.DATABASE_DURABLE_OBJECT.get(id, { locationHint: region as DurableObjectLocationHint }) : env.DATABASE_DURABLE_OBJECT.get(id);

        const source: Source = request.headers.get('X-Starbase-Source') as Source ?? url.searchParams.get('source') as Source ?? 'internal';
        const dataSource: DataSource = {
            source: source,
            request: request.clone(),
            internalConnection: {
                durableObject: stub as unknown as DatabaseStub,
            },
            externalConnection: {
                outerbaseApiKey: env.OUTERBASE_API_KEY ?? ''
            }
        };

        const response = await new Handler().handle(request, dataSource, env);

        // ## DO NOT REMOVE: TEMPLATE ROUTING ##

        return response;
	},
} satisfies ExportedHandler<Env>;
