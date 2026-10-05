/**
 * @see https://techdocs.gbif.org/en/openapi/
 * @example https://api.gbif.org/v1/species/match?name=Quercus%20robur
 * @example https://api.gbif.org/v1/occurrence/search?kingdom=Plantae&year=1800%2C1899&hasCoordinate=true&limit=300&offset=0
 * @example URL: https://api.gbif.org/v1/species/5384396
*/

const remoteConf = {
    host: 'api.gbif.org',
    protocol: "https:",
    port: 443,
    rateLimit: 8, // Requests per second
    rollingWindow: 1000, // in milliseconds
    headers: {},
    endpoints: {
        speciesByName: {
            method: 'GET',
            pathname: '/v1/species/match',
            build: ({ name }) => ({
                searchParams: {
                    name
                }
            })
        },
        occurrenceYear: {
            method: 'GET',
            pathname: '/v1/occurrence/search',
            build: ({ kingdomKey, year, limit, offset }) => ({
                searchParams: {
                    kingdomKey,
                    year,
                    hasCoordinate: true,
                    limit,
                    offset
                }
            })
        },
        speciesKey: {
            method: 'GET',
            searchParams: {},
            build: ({ taxonKey }) => ({
                pathname: `/v1/species/${taxonKey}`
            })
        }
    }
}

export default remoteConf;
