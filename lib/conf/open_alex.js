/**
 * @see https://help.openalex.org/api/
 * @see https://help.openalex.org/api/get-single-entities/
 * @example https://api.openalex.org/works/W2741809807
 * @example https://api.openalex.org/works?filter=publication_year:2020&per_page=1&cursor=*
*/

import fs from "fs";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateKeys } from "../modules/utilities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envJSON = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../keys/openalex.json'), "utf-8"));

const { OA_API_KEY } = validateKeys({
    OA_API_KEY: {value: envJSON.OPENALEX_API_KEY, validator: value => /^[A-Za-z0-9]+$/.test(value)},
});

const remoteConf = {
    host: 'api.openalex.org',
    protocol: "https:",
    port: 443,
    rateLimit: 5, // Requests per second
    rollingWindow: 1000, // in milliseconds
    headers: {},
    endpoints: {
        OA_filter: {
            method: 'GET',
            pathname: `/works`,
            build: ({ filter, per_page, cursor }) => ({
                searchParams: {
                    api_key: OA_API_KEY,
                    filter,
                    per_page,
                    cursor
                }
            })
        },
        OA_singleton: {
            method: 'GET',
            //searchParams: {},
            body: {},
            build: ({ prefix, id_mag }) => ({
              pathname: `/works/${prefix}${id_mag}`  
            })
        }
    }
}

export default remoteConf;


