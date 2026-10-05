/**
 * Example script for an API client sending requests to GitHub
*/

import Logger from './modules/logger.js';
import pinoClient from './conf/pino_client.js'
import APIManager from './modules/api_client.js';
//import APIManager from './modules/api_manager.js';

const logger = new Logger(pinoClient, 30);

const { fetchData } = await APIManager(logger);

simpleTest();

async function simpleTest() {

    const owner = 'ngdias';
    const name = 'HoloField';

    const request = await fetchData('repoInfo', { owner, name });
    logger.info(request);
    
    const request2 = await fetchData('rateLimit', {});
    logger.log(request2);
};
