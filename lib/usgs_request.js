/**
 * Example script for an API client sending requests to USGS
*/

import Logger from './modules/logger.js';
import pinoClient from './conf/pino_client.js'
//import APIManager from './modules/api_client.js';
import APIManager from './modules/api_manager.js';

const logger = new Logger(pinoClient, 30);

const { fetchData, requestStats } = await APIManager(logger);

//simpleTest();
resilienceTest();

async function simpleTest() {

    const format = 'geojson';

    const request = await fetchData('USGS_count', { format });
    logger.log(JSON.stringify(request));
};

async function resilienceTest() {

    let hostPort;
    let reqRate;

    const statusInterval = setInterval(() => {

        ({hostPort, reqRate } = requestStats());

    }, 3000);

    let request;
    const format = 'geojson';
    const starttime = '2000-01-01';
    const endtime = '2001-01-01';
    let offset = 1;
    const limit = 2000;
    const orderby = 'time-asc';

    do {

        request = await fetchData('USGS_query', { format, starttime, endtime, offset, limit, orderby });

        for (const feature of request.features) {
            
            const eventid = feature.id;

            const request2 = await fetchData('USGS_query', { format, eventid });

            logger.status(`«--» ${hostPort} | Req/sec: \x1b[33m${reqRate}\x1b[0m | ` +  
            `${request2.properties.products.origin[0].properties['quakeml-origin-publicid']} «--»`);
        }

    } while (request.features.length === limit);

    clearInterval(statusInterval);
}
