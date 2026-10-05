/**
 * Example script for an API client sending requests to Open Meteo
*/

import Logger from './modules/logger.js';
import pinoClient from './conf/pino_client.js'
import APIManager from './modules/api_client.js';
//import APIManager from './modules/api_manager.js';

const logger = new Logger(pinoClient, 30);

const { fetchData, requestStats } = await APIManager(logger);

simpleTest();
//resilienceTest();
//slowTest();

async function simpleTest() {

    let latitude; let longitude;

    latitude = 52.52;
    longitude = 13.41;
    const hourly = 'temperature_2m';
    const forecast_days = 1;

    const request = await fetchData('meteo_forecast', { latitude, longitude, hourly, forecast_days });
    logger.log(JSON.stringify(request));

    latitude = 41.1579;
    longitude = -8.6291;
    const current = 'temperature_2m,wind_speed_10m,precipitation';

    const request2 = await fetchData('meteo_forecast', { latitude, longitude, current });
    logger.log(JSON.stringify(request2.current));
}

async function resilienceTest() {

    let hostPort;
    let reqRate;

    const statusInterval = setInterval(() => {

        ({hostPort, reqRate } = requestStats());

    }, 3000);

    const hourly = 'temperature_2m';
    const forecast_days = 1;

    for (let latitude = -90; latitude <= 90; latitude += 1) {

        for (let longitude = -180; longitude <= 180; longitude += 1) {

            const request = await fetchData('meteo_forecast', { latitude, longitude, hourly, forecast_days });
            
            logger.status(`«--» ${hostPort} | Req/sec: \x1b[33m${reqRate}\x1b[0m | ` +  
            `${latitude}º ${longitude}º Temp: ${request.hourly.temperature_2m[0]}º «--»`);
        }
    }

    clearInterval(statusInterval);
}

async function slowTest() {

    const latitude = 41.1579;
    const longitude = -8.6291;
    const current = 'temperature_2m,wind_speed_10m,precipitation'

    const poll = async () => {
        
        const request = await fetchData('meteo_forecast', { latitude, longitude, current });
        
        const { hostPort, reqRate } = requestStats();

        logger.status(`«--» ${hostPort} | Requests/second: \x1b[33m${reqRate}\x1b[0m | ${JSON.stringify(request.current)} «--»`);

        setTimeout(poll, 900 * 1000);
    };

    poll();
}
