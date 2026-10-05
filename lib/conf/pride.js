/**
 * @see https://www.ebi.ac.uk/pride/ws/archive/v3/webjars/swagger-ui/index.html
 * @example https://www.ebi.ac.uk/pride/ws/archive/v3/proteins/P61586
 * @example https://www.ebi.ac.uk/pride/ws/archive/v3/projects/PXD033513
*/

const remoteConf = {
    host: 'www.ebi.ac.uk',
    protocol: "https:",
    port: 443,
    rateLimit: 8, // Requests per second
    rollingWindow: 1000, // in milliseconds
    headers: {},
    endpoints: {
        PRIDE_prot: {
            method: 'GET',
            searchParams: {},
            build: ({ proteinAcce }) => ({
                pathname: `/pride/ws/archive/v3/proteins/${proteinAcce}`
            })
        },
        PRIDE_proj: {
            method: 'GET',
            searchParams: {},
            build: ({ projectAcce }) => ({
                pathname: `/pride/ws/archive/v3/projects/${projectAcce}`
            })
        }
    }
}

export default remoteConf;
