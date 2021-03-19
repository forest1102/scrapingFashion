import { execScrape } from './scrapers/index'
import { CloudStorage } from './saver'
import List from './lists'
import * as path from 'path'
// execScrape(
//   process.argv,
//   async (count, err) =>
//     err ? console.log(err) : console.log('Count: ', count),
//   () => {
//     console.log(process.memoryUsage())
//     return Promise.resolve()
//   }
// )

;(async data => {
  console.log(' start')
  const { archiveFolder, datafileFolder } = data
  const readFrom = new CloudStorage('scraping-datafiles', datafileFolder)
  const workbookMacro = await readFrom.readExcel('putupbuyma-0.60.xlsm', {
    processed_data: '変換後',
    data: 'data',
    output_data: 'Sheet2'
  })
  await new List(readFrom).getConstantsAsync().then(constants => {
    const I2Cell = workbookMacro.getCell('Sheet1', 'I2')
    I2Cell.value(
      path.win32.join(
        constants.フォルダ ?? I2Cell.value(),
        archiveFolder,
        'img'
      )
    )
  })
  const archives = new CloudStorage('scraping-archives', archiveFolder)
  await archives
    .readExcel(archiveFolder + ' data.xlsx', {
      processed_data: '変換後',
      data: 'data',
      output_data: '出品用data'
    })
    .then(xlsx => workbookMacro.copySheets(xlsx))
  console.log('finished copying')
  await archives.saveExcel(
    workbookMacro,
    archiveFolder + ' putupbuyma-0.60.xlsm'
  )
  // await job.agenda.schedule('in 60 seconds', agendaNames.zipFiles, {
  //   saveTo: archiveFolder
  // })
  // done()
})({
  archiveFolder: process.argv[2],
  datafileFolder: process.argv[3]
}).catch(err => console.log(err))
