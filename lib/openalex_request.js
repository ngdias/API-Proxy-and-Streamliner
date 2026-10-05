/**
 * Example script for an API client sending requests to Open Alex
 * 
 * OpenAlex IDs - Every entity has a unique OpenAlex ID with a letter prefix indicating the type:
 * 
 * Prefix	Entity
 *   W	    Work
 *   A	    Author
 *   S	    Source
 *   I	    Institution
 *   T	    Topic
 *   K	    Keyword
 *   P	    Publisher
 *   F	    Funder
 *   G	    Award
*/

import Logger from './modules/logger.js';
import pinoClient from './conf/pino_client.js'
import APIManager from './modules/api_client.js';
//import APIManager from './modules/api_manager.js';

const logger = new Logger(pinoClient, 30);

const { fetchData, requestStats } = await APIManager(logger);

simpleTest();
//resilienceTest();

async function simpleTest() {

    const filter = 'publication_year:2020';
    const per_page = 1;
    const cursor = '*';

    const request = await fetchData('OA_filter', { filter, per_page, cursor });
    logger.log(request);
    logger.info(request.meta.next_cursor);
    logger.info(request.results[0].doi);
    logger.info(request.results[0].id);
    logger.info(request.results[0].ids.mag);
    logger.info(request.results[0].title);

    const prefix = 'W';
    const id_mag = request.results[0].ids.mag;

    const request2 = await fetchData('OA_singleton', { prefix, id_mag });
    logger.log(request2.title);
}

async function resilienceTest() {

    let hostPort;
    let reqRate;

    const statusInterval = setInterval(() => {

        ({hostPort, reqRate } = requestStats());

    }, 3000);

    const filter = 'publication_year:2021';
    const per_page = 100;
    let cursor = '*';

    do { 
        const request = await fetchData('OA_filter', { filter, per_page, cursor });
        
        cursor = request.meta.next_cursor;

        const prefix = 'W';

        for (const title of request.results) {

            const id_mag = title.ids.mag;

            if (id_mag) {

                const request2 = await fetchData('OA_singleton', { prefix, id_mag });

                if (!request2) continue;

                logger.status(`«--» ${hostPort} | Requests/second: \x1b[33m${reqRate}\x1b[0m | ${request2.doi} «--»`);
            }
        }

    } while (cursor);

    clearInterval(statusInterval);
}
