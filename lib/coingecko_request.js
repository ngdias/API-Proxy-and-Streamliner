/**
 * Example script for an API client sending requests to CoinGecko
*/ 

import Logger from './modules/logger.js';
import pinoClient from './conf/pino_client.js'
import APIManager from './modules/api_client.js';
//import APIManager from './modules/api_manager.js';

const logger = new Logger(pinoClient, 30);

const { fetchData, requestStats } = await APIManager(logger);

let hostPort;
let reqRate;

const statusInterval = setInterval(() => {

    ({hostPort, reqRate } = requestStats());

    let rateDisplay;

      if (reqRate < 0.1 && reqRate > 0) {
        const reqPerMin = reqRate * 60;
        rateDisplay = `${reqPerMin.toFixed(2)} req/min`;

      } else {
        rateDisplay = `${reqRate} req/sec`;
      }

    logger.status(`«--» ${hostPort} | Request rate: \x1b[33m${rateDisplay}\x1b[0m «--»`);

}, 15000); 

const symbols = [
  'aave',     'ethereum',    'hype',      'aster',    'gala',     'the-sandbox',
  'beat',     'usd-coin',    'near',      'bitcoin',  'folk',     'enjincoin',
  'dot',      'litecoin',    'dash',      'cardano',  'pivx',     'dogecoin',    
  'nano',     'arbitrum',    'digibyte',  'light',    'link',     'form',
  'eos',      'ravencoin',   'iota',      'waves',    'night',    'pippin', 
  'qtum',     'omisego',     'ontology',  'sui',      'swarm',    'basic-attention-token',
  'truth',    'zilliqa',     'wet',       'augur',    'status',   'monero', 
  '0x',       'popcat',      'zcash',     'tether',   'tron',     'binancecoin',
  'near',     'shiba-inu',   'uniswap',   'cosmos',   'stellar',  'hedera-hashgraph',
  'aptos',    'filecoin',    'sui',       'fantom',   'tezos',    'the-open-network', 
  'flow',     'optimism',    'vechain',   'kaspa',    'mantle',   'injective-protocol',
  'cronos',   'algorand',    'neo',       'celo',     'neo',      'mina-protocol', 
  'dai',      'celestia',    'frax',      'usdd',     'okb',      'gemini-dollar', 
  'gate',     'true-usd',    'leo-token', 'helium',   'optimism', 'immutable-x',
  'fetch-ai', 'liquity-usd', 'grass',     'livepeer', 'arweave',  'ocean-protocol', 
  'solana',   'loopring',    'gnosis',    'chiliz',   'harmony',  'kusama',
  'bonk',     'htx-token',   'pepe',      'brett',    'mog-coin', 'book-of-meme',
  'apecoin',  'ronin',       'bittensor', 'illuvium', 'beam',     'akash-network'];

for (const coin of symbols) {

    const request = await fetchData('current_coin_price', {ids: coin, vs_currencies: 'usd'});

    logger.log(JSON.stringify(request));
}

clearInterval(statusInterval);
