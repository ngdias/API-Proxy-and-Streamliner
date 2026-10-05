/**
 * @see https://docs.coingecko.com/reference/authentication
 * @see https://docs.coingecko.com/docs/keyless-public-api#available-endpoints
 * @example https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd
*/

const remoteConf = {
    host: 'api.coingecko.com',
    protocol: "https:",
    port: 443,
    rateLimit: 1, // requests per second (CG allows 5-15 requests *per minute* in free plan)
    rollingWindow: 13000, // in milliseconds
    headers: {},
    endpoints: {
        current_coin_price: { // https://docs.coingecko.com/demo/reference/simple-price
            method: 'GET',
            build: ({ ids, vs_currencies }) => ({
                pathname: `/api/v3/simple/price`,
                searchParams: {
                    ids,
                    vs_currencies
                }
            })
        },
        historical_coin_price: {
            method: 'GET',
            build: ({ coin, date }) => ({
                pathname: `/api/v3/coins/${coin}/history`,
                searchParams: {
                    date,
                    localization: false
                }
            })
        }
    }
}

export default remoteConf;
