/**
 * File utama untuk mengatur konfigurasi persimpangan dan logika tampilan.
 */
import { drawUtara } from './InfrastrukturJalan/utara.js';
import { drawTimur } from './InfrastrukturJalan/timur.js';
import { drawSelatan } from './InfrastrukturJalan/selatan.js';
import { drawBarat } from './InfrastrukturJalan/barat.js';
import { drawTurningRadius } from './InfrastrukturJalan/drawTurningRadius.js';
import { drawTengah } from './InfrastrukturJalan/tengah.js';
import { LampuLaluLintas } from './LampuLaluLintas.js';
import { getLaneButtonPositions } from './InfrastrukturJalan/drawArrow.js';
import { drawLaneCenters, drawVehicle } from "./vehicle.js";

// === Canvas utama & kendaraan ===
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const vehicleCanvas = document.getElementById("vehicleCanvas");
const vctx = vehicleCanvas.getContext("2d");

// === Konfigurasi awal jalan ===
const config = {
    utara: { in: 2, out: 2 },
    timur: { in: 2, out: 2 },
    selatan: { in: 2, out: 2 },
    barat: { in: 2, out: 2 },
    skala_px: 10,
    radiusValue: 5
};
const lampu = new LampuLaluLintas("simCanvas");

// === Konfigurasi arus lalu lintas tiap arah ===
const configTraffic = {
    utara: { flow: 500, truckPct: 20 },
    timur: { flow: 500, truckPct: 20 },
    selatan: { flow: 500, truckPct: 20 },
    barat: { flow: 500, truckPct: 20 },
};

// === Konstanta kapasitas maksimum per lajur (HCM) ===
const MAX_FLOW_PER_LANE = 1900; // smp/jam/lajur
function getMaxFlow(arah) {
    return config[arah].in * MAX_FLOW_PER_LANE;
}

// === Panah lajur (ikon pergerakan) ===
const arrowTypes = ["left","straight","right","left_straight","straight_right","left_right","left_straight_right"];
const arrowImages = {};
const loadImagePromises = arrowTypes.map(type => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { arrowImages[type] = img; resolve(); };
        img.onerror = reject;
        img.src = `js/arrowIcons/${type}.png`;
    });
});
let laneArrows = { utara: [], timur: [], selatan: [], barat: [] };

// === Dropdown jumlah lajur ===
function populateDropdown(id) {
    const select = document.getElementById(id);
    for (let i=1;i<=5;i++){
        const opt=document.createElement('option');
        opt.value=i; opt.textContent=i;
        select.appendChild(opt);
    }
    select.value=2;
}
['inNorth','outNorth','inEast','outEast','inSouth','outSouth','inWest','outWest'].forEach(populateDropdown);
['inNorth','outNorth','inEast','outEast','inSouth','outSouth','inWest','outWest'].forEach(id=>{
    document.getElementById(id).addEventListener('change', updateConfig);
});

// === Slider Radius ===
const radiusSlider=document.getElementById("customRange");
const radiusValueDisplay=document.getElementById("rangeVal");
radiusSlider.addEventListener("input",function(){
    config.radiusValue=parseFloat(this.value);
    radiusValueDisplay.textContent=this.value;
    lampu.updatePosition(config);
    drawLayout();
});

// === Slider Arus & Persentase Truk ===
const directionSelect=document.getElementById("directionSelect");
const flowSlider=document.getElementById("trafficFlowSlider");
const flowValue=document.getElementById("flowValue");
const truckSlider=document.getElementById("truckPercentageSlider");
const truckValue=document.getElementById("truckPercentageValue");

function updateTrafficUI(){
    const arah = directionSelect.value;
    const maxFlow = getMaxFlow(arah);

    flowSlider.max = maxFlow;
    configTraffic[arah].flow = Math.min(configTraffic[arah].flow, maxFlow);
    flowSlider.value = configTraffic[arah].flow;
    flowValue.textContent = `${flowSlider.value} smp/jam (maks: ${maxFlow})`;

    truckSlider.value = configTraffic[arah].truckPct;
    truckValue.textContent = `${configTraffic[arah].truckPct}%`;
}
updateTrafficUI();

directionSelect.addEventListener("change", updateTrafficUI);
flowSlider.addEventListener("input",()=>{
    const arah = directionSelect.value;
    configTraffic[arah].flow = parseInt(flowSlider.value);
    flowValue.textContent = `${flowSlider.value} smp/jam (maks: ${flowSlider.max})`;
});
truckSlider.addEventListener("input",()=>{
    const arah = directionSelect.value;
    configTraffic[arah].truckPct = parseInt(truckSlider.value);
    truckValue.textContent = `${truckSlider.value}%`;
});

// === Update Config saat dropdown jumlah lajur berubah ===
function updateConfig(){
    config.utara.in=parseInt(document.getElementById('inNorth').value);
    config.utara.out=parseInt(document.getElementById('outNorth').value);
    config.timur.in=parseInt(document.getElementById('inEast').value);
    config.timur.out=parseInt(document.getElementById('outEast').value);
    config.selatan.in=parseInt(document.getElementById('inSouth').value);
    config.selatan.out=parseInt(document.getElementById('outSouth').value);
    config.barat.in=parseInt(document.getElementById('inWest').value);
    config.barat.out=parseInt(document.getElementById('outWest').value);

    laneArrows.utara=Array(config.utara.in).fill("straight");
    laneArrows.timur=Array(config.timur.in).fill("straight");
    laneArrows.selatan=Array(config.selatan.in).fill("straight");
    laneArrows.barat=Array(config.barat.in).fill("straight");

    lampu.updatePosition(config);
    updateTrafficUI();
    drawLayout();
}

// === Klik panah untuk ganti jenis pergerakan ===
canvas.addEventListener('click',function(event){
    const rect=canvas.getBoundingClientRect();
    const x=event.clientX-rect.left;
    const y=event.clientY-rect.top;
    ["utara","timur","selatan","barat"].forEach(arah=>{
        const positions=getLaneButtonPositions(ctx,config,arah);
        const targetSize=25;
        positions.forEach((pos,i)=>{
            let finalWidth,finalHeight;
            const img=arrowImages[laneArrows[arah][i]];
            if(img&&img.complete){
                const aspectRatio=img.width/img.height;
                if(arah==="selatan"||arah==="utara"){ finalWidth=targetSize; finalHeight=finalWidth/aspectRatio; }
                else { finalHeight=targetSize; finalWidth=finalHeight*aspectRatio; }
            }
            const boxX=pos.x-finalWidth/2;
            const boxY=pos.y-finalHeight/2;
            if(x>=boxX&&x<=boxX+finalWidth&&y>=boxY&&y<=boxY+finalHeight){
                const currentType=laneArrows[arah][i];
                const currentIndex=arrowTypes.indexOf(currentType);
                const nextIndex=(currentIndex+1)%arrowTypes.length;
                laneArrows[arah][i]=arrowTypes[nextIndex];
                drawLayout();
            }
        });
    });
});

// === Gambar Layout Jalan + Panah + Lampu ===
function drawLayout(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    lampu.updatePosition(config);

    drawUtara(ctx,config);
    drawSelatan(ctx,config);
    drawTimur(ctx,config);
    drawBarat(ctx,config);
    drawTengah(ctx,config);
    if(!isNaN(config.radiusValue)) drawTurningRadius(ctx,config,config.radiusValue);

    ["utara","timur","selatan","barat"].forEach(arah=>{
        const positions=getLaneButtonPositions(ctx,config,arah);
        const targetSize=25;
        positions.forEach((pos,i)=>{
            const type=laneArrows[arah][i]||"straight";
            const img=arrowImages[type];
            if(img&&img.complete){
                const aspectRatio=img.width/img.height;
                let finalWidth,finalHeight;
                if(arah==="selatan"||arah==="utara"){ finalWidth=targetSize; finalHeight=finalWidth/aspectRatio; }
                else { finalHeight=targetSize; finalWidth=finalHeight*aspectRatio; }
                ctx.save();
                if(arah==="utara"){ ctx.translate(pos.x,pos.y); ctx.rotate(Math.PI); ctx.translate(-pos.x,-pos.y); }
                else if(arah==="timur"){ ctx.translate(pos.x,pos.y); ctx.rotate(-Math.PI/2); ctx.translate(-pos.x,-pos.y); }
                else if(arah==="barat"){ ctx.translate(pos.x,pos.y); ctx.rotate(Math.PI/2); ctx.translate(-pos.x,-pos.y); }
                ctx.drawImage(img,pos.x-finalWidth/2,pos.y-finalHeight/2,finalWidth,finalHeight);
                ctx.restore();
            }
        });
    });
    lampu.draw();
}

// === Kendaraan dengan distribusi Poisson (via exponential interarrival times) ===
const vehicles=[];
let nextSpawnTimes = { utara:0, timur:0, selatan:0, barat:0 };

// Sampling waktu antar kedatangan kendaraan
function getExponentialInterval(flow){
    if(flow<=0) return Infinity;
    const mean = 3600 / flow; // detik rata-rata antar kendaraan
    return -Math.log(1 - Math.random()) * mean * 1000; // konversi ke ms
}
function scheduleNextSpawn(arah, currentTime){
    const flow = configTraffic[arah].flow;
    const interval = getExponentialInterval(flow);
    nextSpawnTimes[arah] = currentTime + interval;
}
function createRandomVehicle(forcedDirection=null){
    const directions=['utara','timur','selatan','barat'];
    const arah=forcedDirection || directions[Math.floor(Math.random()*directions.length)];
    const laneCount=config[arah].in;
    if(laneCount===0) return;

    // Pilih jenis kendaraan
    const truckPct=configTraffic[arah].truckPct;
    const rnd=Math.random()*100;
    let type="mobil";
    if(rnd<truckPct) type="truk";
    else if(rnd<truckPct+30) type="motor";
    else type="mobil";

    // Tentukan posisi spawn
    const laneIndex=Math.floor(Math.random()*laneCount);
    const skala=config.skala_px*3;
    const offset=(laneIndex+0.5)*skala;
    let x,y,dx=0,dy=0;
    switch(arah){
        case 'utara': x=canvas.width/2+offset; y=-20; dy=1; break;
        case 'timur': x=canvas.width+20; y=canvas.height/2+offset; dx=-1; break;
        case 'selatan': x=canvas.width/2-offset; y=canvas.height+20; dy=-1; break;
        case 'barat': x=-20; y=canvas.height/2-offset; dx=1; break;
    }
    vehicles.push({x,y,dx,dy,type,direction:arah});
}

// === Animasi utama ===
let lastTimestamp=0;
function animate(timestamp){
    const deltaTime=timestamp-lastTimestamp;
    lastTimestamp=timestamp;

    lampu.tick(deltaTime);
    drawLayout();

    vctx.clearRect(0,0,vehicleCanvas.width,vehicleCanvas.height);
    drawLaneCenters(vctx,config);

    // Spawn kendaraan per arah (independen pakai Poisson)
    for(const arah of ['utara','timur','selatan','barat']){
        if(timestamp >= nextSpawnTimes[arah]){
            createRandomVehicle(arah);
            scheduleNextSpawn(arah, timestamp);
        }
    }

    // Update posisi kendaraan
    vehicles.forEach(vehicle=>{
        const speed=0.1;
        if(vehicle.direction==='utara') vehicle.y+=speed*deltaTime;
        if(vehicle.direction==='selatan') vehicle.y-=speed*deltaTime;
        if(vehicle.direction==='timur') vehicle.x-=speed*deltaTime;
        if(vehicle.direction==='barat') vehicle.x+=speed*deltaTime;

        vctx.save();
        vctx.translate(vehicle.x,vehicle.y);
        if(vehicle.direction==='timur') vctx.rotate(-Math.PI/2);
        else if(vehicle.direction==='barat') vctx.rotate(Math.PI/2);
        else if(vehicle.direction==='utara') vctx.rotate(Math.PI);
        drawVehicle(vctx,{x:0,y:0,type:vehicle.type});
        vctx.restore();
    });

    // Hapus kendaraan yang keluar canvas
    for(let i=vehicles.length-1;i>=0;i--){
        const v=vehicles[i];
        if(v.x<-50||v.x>vehicleCanvas.width+50||v.y<-50||v.y>vehicleCanvas.height+50){
            vehicles.splice(i,1);
        }
    }

    requestAnimationFrame(animate);
}

// === Start Simulation ===
Promise.all(loadImagePromises).then(()=>{
    updateConfig();
    lampu.updatePosition(config);
    for(const arah of ['utara','timur','selatan','barat']){
        scheduleNextSpawn(arah, 0);
    }
    requestAnimationFrame(animate);
}).catch(err=>console.error("Gagal memuat gambar panah:",err));
