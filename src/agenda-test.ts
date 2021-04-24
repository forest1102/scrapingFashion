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
agenda.defaultConcurrency(2)
const agendaNames = Object.freeze({
  zipFiles: 'zip-files',
  execScrape: 'exec-scrape',
  updateSchedule: 'update-schedule'
} as const)

agenda.define(
  agendaNames.zipFiles,
  { priority: 'high', concurrency: 1 },
  async (job, done) => {
    const localFilename = path.join(__dirname, '../data/', uuid() + '.zip')
    let saveTo = job.attrs.data.saveTo as string
    console.log(saveTo)
    if (!saveTo.endsWith('/')) saveTo += '/'
    try {
      console.log('zip files from: ', saveTo)
      const storage = new CloudStorage('scraping-archives')
      const remoteZip = path.join(saveTo.slice(0, -1) + '.zip')
      if ((await storage.getFile(remoteZip).exists())[0]) {
        console.log('exists')
        return done()
      }
      const [files] = await storage.listFiles(saveTo)
      const localSaver = fs.createWriteStream(localFilename)
      localSaver
        .on('error', err => {
          throw err
        })
        .on('close', () => {
          job
            .touch()
            .then(() => storage.uploadFrom(localFilename, remoteZip))
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
      zipper
        .on('warning', function(err) {
          if (err.code === 'ENOENT') {
            // log warning
            console.log(err)
          } else {
            throw err
          }
        })
        .on('error', err => {
          throw err
        })
      zipper.pipe(localSaver)
      for (let i = 0, len = files.length; i < len; ++i) {
        const name = files[i].name.slice(saveTo.length)
        console.log(`${i} / ${len} zipped: `, name)
        zipper.append((await files[i].download())[0], {
          name
        })
        await job.touch()
      }

      await zipper.finalize()
      await job.touch()
      console.log('zip finalized')
    } catch (e) {
      console.log(e)
      await fs.unlink(localFilename).catch(e => done(e))
    }
  }
)
agenda.define('exec-scrape', async (job, done) => {
  try {
    const spreadsheet = new SpreadSheet(
      '1dtWIA9CLkzU_U_ujDtl-70UMb-KttUwGoMReStMXdv4'
    )

    const rowIdx = job.attrs.data.rowIdx as number
    const argv = job.attrs.data.argv as string[]
    if (!rowIdx || !argv) console.log('not defined')
    await spreadsheet.updateCell('I' + rowIdx, [
      [moment().format('YYYY/MM/DD HH:mm:ss'), '', '']
    ])
    await spreadsheet.updateCell('M' + rowIdx, [['']])
    console.log('started', argv)
    const { count, saveTo, err } = await execScrape(argv, () =>
      job.touch().catch(err => console.log(err))
    )
    await spreadsheet.updateCell('J' + rowIdx, [
      [
        moment().format('YYYY/MM/DD HH:mm:ss'),
        count,
        '',
        err
          ? truncate(JSON.stringify(err.message || err.errors || err), {
              length: 500
            })
          : ''
      ]
    ])

    saveTo &&
      (await agenda
        .create(agendaNames.zipFiles, {
          saveTo
        })
        .schedule(new Date())
        .unique({ 'data.saveTo': saveTo })
        .save())

    done()
  } catch (e) {
    console.log(e)
    done(e)
  }
})
agenda.define('update-schedule', async (job, done) => {
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
agenda.on('fail', err => {
  console.log(err)
})
agenda.on('complete', (job: Agenda.Job) => {
  console.log(
    `Job ${job.attrs.name} finished with params: ${JSON.stringify(
      job.attrs.data
    )}`
  )
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
  if (process.argv[2] == 'zip-files' && process.argv.length > 3) {
    for (let saveTo of process.argv.slice(3)) {
      await agenda
        .create(agendaNames.zipFiles, {
          saveTo
        })
        .schedule(new Date())
        .unique({ 'data.saveTo': saveTo })
        .save()
    }
  } else if (process.argv[2] == 'cancel-all') {
    await agenda.cancel({})

    await agenda.stop()
    // await agenda.every('0 0 * * *', agendaNames.updateSchedule)
  } else if (process.argv[2] === 'test') {
    const rowIdx = +process.argv[3]
    const argv = ['', '', ...process.argv.slice(4)]
    await agenda
      .create(agendaNames.execScrape, { rowIdx, argv })
      .priority('highest')
      .schedule(new Date())
      .save()
    // await agenda.every('0 0 * * *', agendaNames.updateSchedule)
  } else {
    console.log('schedule: ', 'update-schedule')
    await agenda.cancel({ name: agendaNames.updateSchedule })
    await agenda
      .create(agendaNames.updateSchedule)
      .repeatEvery('1 day')
      .save()
  }
})().catch(err => console.log(err))
