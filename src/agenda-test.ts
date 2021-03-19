import { execScrape } from './scrapers/index'
import * as moment from 'moment'
import { SpreadSheet, CloudStorage } from './saver'
import * as Agenda from 'agenda'
import * as archiver from 'archiver'
import * as path from 'path'
import { v1 as uuid } from 'uuid'
import * as fs from 'fs-extra'
import List from './lists'
import { reduce, truncate } from 'lodash'

const agenda = new Agenda({
  db: { address: 'mongodb://127.0.0.1:27017/agenda' }
})
const agendaNames = Object.freeze({
  zipFiles: 'zip-files',
  execScrape: 'exec-scrape',
  updateSchedule: 'update-schedule',
  addMacroWorbook: 'add-macro-workbook'
} as const)

agenda.define(agendaNames.zipFiles, { priority: 'high' }, async (job, done) => {
  const localFilename = path.join(__dirname, '../data/', uuid() + '.zip')
  let saveTo = job.attrs.data.saveTo as string
  console.log(saveTo)
  if (!saveTo.endsWith('/')) saveTo += '/'
  try {
    console.log('zip files from: ', saveTo)
    const storage = new CloudStorage('scraping-archives')
    const [files] = await storage.listFiles(saveTo)
    const localSaver = fs.createWriteStream(localFilename)
    localSaver.on('close', () => {
      storage
        .uploadFrom(localFilename, path.join(saveTo.slice(0, -1) + '.zip'))
        .then(() => fs.unlink(localFilename))
        .then(() => storage.deleteFolder(saveTo))
        .then(() => done())
        .catch(done)
    })
    const zipper = archiver('zip', {
      zlib: {
        level: 9
      }
    })
    zipper.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        // log warning
        console.log(err)
      } else {
        console.log(err)
        // throw error
        fs.unlink(localFilename)
          .then(() => done(err))
          .catch(() => done(Error('unable to delete')))
      }
    })
    zipper.pipe(localSaver)
    for (let i = 0, len = files.length; i < len; ++i) {
      const name = files[i].name.slice(saveTo.length)
      zipper.append(
        files[i].createReadStream().on('end', () => {
          console.log(`${i} / ${len} zipped: `, name)
        }),
        {
          name
        }
      )
    }

    await zipper.finalize()
    console.log('zip finalized')
  } catch (e) {
    console.log(e)
    await fs.unlink(localFilename).catch(e => done(e))
  }
})
agenda.define(agendaNames.addMacroWorbook, async (job, done) => {
  console.log(agendaNames.addMacroWorbook, ' start')
  const { archiveFolder, datafileFolder } = job.attrs.data
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
  // await archives
  //   .readExcel(archiveFolder + ' data.xlsx', {
  //     processed_data: '変換後',
  //     data: 'data',
  //     output_data: '出品用data'
  //   })
  //   .then(xlsx => workbookMacro.copySheets(xlsx))
  console.log('finished copying')
  await archives.saveExcel(
    workbookMacro,
    archiveFolder + ' putupbuyma-0.60.xlsm'
  )
  // await job.agenda.schedule('in 60 seconds', agendaNames.zipFiles, {
  //   saveTo: archiveFolder
  // })
  done()
})
agenda.define('exec-scrape', async (job, done) => {
  const spreadsheet = new SpreadSheet(
    '1dtWIA9CLkzU_U_ujDtl-70UMb-KttUwGoMReStMXdv4'
  )

  const rowIdx = job.attrs.data.rowIdx as number
  const argv = job.attrs.data.argv as string[]
  if (!rowIdx || !argv) console.log('not defined')
  spreadsheet
    .updateCell('I' + rowIdx, [
      [moment().format('YYYY/MM/DD HH:mm:ss'), '', '']
    ])
    .then(() => {
      console.log('started', argv)
      execScrape(
        argv,
        (count, saveTo, err) => {
          return (err
            ? spreadsheet.updateCell('J' + rowIdx, [
                [
                  moment().format('YYYY/MM/DD HH:mm:ss'),
                  count,
                  truncate(JSON.stringify(err), { length: 100 })
                ]
              ])
            : spreadsheet.updateCell('J' + rowIdx, [
                [moment().format('YYYY/MM/DD HH:mm:ss'), count]
              ])
          )
            .then(
              () =>
                saveTo &&
                job.agenda.schedule('in 60 seconds', agendaNames.zipFiles, {
                  saveTo
                })
            )
            .then(() => done())
            .catch(err => {
              console.log(err)
            })
        },
        count => job.touch().catch(err => console.log(err))
      )
    })
    .catch(err => {
      console.log(err)
      done()
    })
})
agenda.define('update-schedule', { priority: 'low' }, async (job, done) => {
  console.log(agendaNames.updateSchedule, ' start')
  const atob = <T>(str: T) =>
    Buffer.from(JSON.stringify(str), 'utf8').toString('base64')
  const spreadsheet = new SpreadSheet(
    '1dtWIA9CLkzU_U_ujDtl-70UMb-KttUwGoMReStMXdv4'
  )
  const newSchedule: string[][] = await spreadsheet.getCells('A2:H')

  const scheduleToDel = reduce(
    await agenda.jobs({ name: agendaNames.execScrape }),
    (acc, cur) => ({ ...acc, [cur?.attrs?.data?.hash ?? 'none']: cur }),
    {} as { [key: string]: Agenda.Job }
  )

  console.log(Object.keys(scheduleToDel))

  for (const [idx, row] of newSchedule.entries()) {
    const hash = atob(row)
    if (row.length == 0 || row[0] === '' || row[1] === '') continue
    const startFrom = moment(row[0], 'YYYY/MM/DD HH:mm')
    const rule = `${row[1]} days`
    const argv = ['', '', ...row.slice(3)]
    const rowIdx = idx + 2
    if (scheduleToDel[hash]) {
      delete scheduleToDel[hash]
    } else {
      const job = await agenda
        .create(agendaNames.execScrape, { hash, argv, rowIdx })
        .repeatEvery(rule, { timezone: 'Asia/Tokyo' })
        .schedule(startFrom.toDate())
        .save()
      console.log('schedule: ' + JSON.stringify(job.attrs, null, 2))
    }
  }
  for (const hash of Object.keys(scheduleToDel)) {
    console.log('delete schedule:', scheduleToDel[hash].attrs.data)
    await scheduleToDel[hash].remove()
  }
  done()
})
;(async function() {
  console.log('start agenda at: ', moment().format())

  async function graceful() {
    await agenda.stop()
    process.exit(0)
  }

  process.on('SIGTERM', graceful)
  process.on('SIGINT', graceful)
  await agenda.start()
  agenda.defaultConcurrency(3)
  agenda.on('fail', err => {
    console.log(err)
  })
  if (process.argv[2] == 'zip-files' && process.argv.length > 3) {
    for (let saveTo of process.argv.slice(3)) {
      await agenda
        .create(agendaNames.zipFiles, {
          saveTo
        })
        .priority('highest')
        .schedule(new Date())
        .save()
    }
  } else {
    if (process.argv[2] == 'cancel-all') {
      await agenda.cancel({})

      await agenda.now(agendaNames.updateSchedule)
      // await agenda.every('0 0 * * *', agendaNames.updateSchedule)
    } else if (process.argv[2] === 'test') {
      const rowIdx = +process.argv[3]
      const argv = ['', '', ...process.argv.slice(4)]
      await agenda
        .create(agendaNames.execScrape, { rowIdx, argv })
        .priority('highest')
        .schedule(new Date())
        .save()
      await agenda
        .cancel({ name: agendaNames.updateSchedule })
        .then(v => console.log('canceled'))

      await agenda.now(agendaNames.updateSchedule)
      // await agenda.every('0 0 * * *', agendaNames.updateSchedule)
    } else if (process.argv[2] === 'macro') {
      const archiveFolder = process.argv[3]
      const datafileFolder = process.argv[4]
      await agenda.now(agendaNames.addMacroWorbook, {
        archiveFolder,
        datafileFolder
      })
    } else {
      console.log('schedule: ', 'update-schedule')
      await agenda.now(agendaNames.updateSchedule)
    }
  }
})().catch(err => console.log(err))
