/**
 * @see https://open-meteo.com/en/docs
 * @example https://api.open-meteo.com/v1/forecast?latitude=41.1579&longitude=-8.6291&current=temperature_2m,wind_speed_10m,precipitation
 * @example https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m&forecast_days=1
*/

const remoteConf = {
    host: 'api.open-meteo.com',
    protocol: 'https:',
    port: 443,
    rateLimit: 2, // Requests per second
    rollingWindow: 1000, // Proxy-only, for rate limiter; in milliseconds
    headers: {},
    endpoints: {
        meteo_forecast: {
            method: 'GET',
            pathname: `/v1/forecast`,
            build: ({ latitude, longitude, current, hourly, forecast_days }) => ({
                searchParams: {
                    latitude,
                    longitude,
                    current,
                    hourly,
                    forecast_days
                }
            })
        }
    }
}

export default remoteConf;
