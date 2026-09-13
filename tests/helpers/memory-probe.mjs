// QA-only preload; no instrumentation is included in the serving runtime.
let peakRss=0;
const timer=setInterval(()=>peakRss=Math.max(peakRss,process.memoryUsage.rss()),20);timer.unref();
process.on('message',m=>{if(m?.type==='qa:memory')process.send({type:'qa:memory',memory:process.memoryUsage(),sampledPeakRss:peakRss,maxRSSKiB:process.resourceUsage().maxRSS});});
