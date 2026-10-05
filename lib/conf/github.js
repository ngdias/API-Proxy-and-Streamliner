/**
 * @see https://docs.github.com/en/graphql
 * @see https://docs.github.com/en/rest
*/

import fs from "fs";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateKeys } from "../modules/utilities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envJSON = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../keys/github.json'), "utf-8"));

const { GITHUB_TOKEN } = validateKeys({
    GITHUB_TOKEN: {value: envJSON.GITHUB_TOKEN, validator: value => value.startsWith('github_pat_')}
});

const remoteConf = {
    host: 'api.github.com',
    protocol: "https:",
    port: 443,
    rateLimit: 5, // Requests per second
    rollingWindow: 1000, // Proxy-only, for rate limiter; in milliseconds
    headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
    },
    endpoints: {
        repoInfo: {
            method: 'POST',
            pathname: '/graphql',
            searchParams: {},
            build: ({ owner, name }) => ({
                body: { 
                    query: `
                        query RepositoryInfo($owner: String!, $name: String!) {
                            repository(owner: $owner, name: $name) {
                                name
                                description
                                stargazerCount
                                forkCount
                            }
                        }
                    `,
                    variables: {
                        owner,
                        name // repo name
                    }
                }
            })
        },
        rateLimit: {
            method: 'GET',
            pathname: '/rate_limit',
            searchParams: {},
            //build: ({}) => ({}) // can be omitted or just left empty
        }
    }
}

export default remoteConf;
