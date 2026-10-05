/**
 * Example script for an API client sending requests to PRIDE Proteomics
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

    const proteinAcce = 'P61586'; // RhoA

    const request = await fetchData('PRIDE_prot', { proteinAcce });
    logger.log(request);

    const projectAcce = 'PXD019268';

    const request2 = await fetchData('PRIDE_proj', { projectAcce });
    logger.log(request2);
};

async function resilienceTest() {

    let hostPort;
    let reqRate;

    const statusInterval = setInterval(() => {

        ({hostPort, reqRate } = requestStats());

    }, 3000);

    const proteinAcce = 'P61586'; // RhoA

    const request = await fetchData('PRIDE_prot', { proteinAcce });

    for (const projectAcce of request.projects) {

        const request2 = await fetchData('PRIDE_proj', { projectAcce });

        const truncTitle = request2.title.slice(0, 60);

        logger.status(`«--» ${hostPort} | Req/sec: \x1b[33m${reqRate}\x1b[0m | ` +  
            `${request2.accession}: ${truncTitle} «--»`);
    }

    clearInterval(statusInterval);
}
