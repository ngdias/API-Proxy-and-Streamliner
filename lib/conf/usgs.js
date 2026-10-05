/**
 * @see https://earthquake.usgs.gov/fdsnws/event/1/
 * @example https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson
 * @example https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2000-01-01&endtime=2001-01-01&limit=20&orderby=time-asc
 * @example https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=nc21075020&format=geojson",
*/

const remoteConf = {
    host: 'earthquake.usgs.gov',
    protocol: "https:",
    port: 443,
    rateLimit: 10, // Requests per second
    rollingWindow: 1000, // in milliseconds
    headers: {},
    endpoints: {
        USGS_count: {
            method: 'GET',
            pathname: '/fdsnws/event/1/count',
            build: ({ format }) => ({
                searchParams: {
                    format
                }
            })
        },
        USGS_query: {
            method: 'GET',
            pathname: '/fdsnws/event/1/query',
            build: ({ format, starttime, endtime, offset, limit, orderby, eventid }) => ({
                searchParams: {
                    format,
                    starttime,
                    endtime,
                    offset,
                    limit,  
                    orderby,
                    eventid
                }
            })
        }
    }
}

export default remoteConf;
