import * as Agenda from 'agenda'
const agenda = new Agenda({
  db: {
    address: '127.0.0.1:27017/agenda',
    options: {
      useUnifiedTopology: true,
      useNewUrlParser: true
    }
  }
})
agenda.on('ready', () => {
  agenda.schedule('in 5 seconds', 'hello world', { time: new Date() })
  agenda.start()
  agenda.define('hello world', function (job, done) {
    console.log(job.attrs.data.time, 'hello world!')
    done()
  })
})
