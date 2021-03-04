import { execScrape } from './scrapers/index'
execScrape(
  process.argv,
  async count => console.log('Count: ', count),
  () => {}
)
