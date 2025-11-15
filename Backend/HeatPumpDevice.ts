import express from "express";
import http from "http"
import { Server } from "socket.io";
import cors from "cors";
import { ServerNode, Logger /*, Bytes */ } from "@matter/main";
import { MeasurementType } from "@matter/main/types";
import { HeatPumpDevice } from "@matter/main/devices/heat-pump";
import { ThermostatDevice } from "@matter/main/devices/thermostat";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor"
import { HeatPumpDeviceLogic } from "./HeatPumpDeviceLogic.js";
import { HeatPumpThermostatServer } from "./HeatPumpThermostatServer.js";
import { PowerSourceServer } from "@matter/main/behaviors/power-source";
import { PowerTopologyServer } from "@matter/main/behaviors/power-topology";
import { DeviceEnergyManagementServer } from "@matter/main/behaviors/device-energy-management";
import { DeviceEnergyManagement } from "@matter/main/clusters/device-energy-management";
import { ElectricalPowerMeasurementServer } from "@matter/main/behaviors/electrical-power-measurement";
import { ElectricalEnergyMeasurementServer } from "@matter/main/behaviors/electrical-energy-measurement";
import { TemperatureMeasurementServer } from "@matter/main/behaviors/temperature-measurement";
import { ThermostatServer } from "@matter/main/behaviors/thermostat";
import { FlowMeasurementServer } from "@matter/main/behaviors/flow-measurement";
import { PowerSource } from "@matter/main/clusters/power-source";
import fs from "fs";

const logger = Logger.get("ComposedDeviceNode");

const node = new ServerNode({
    productDescription: {},
    basicInformation: {
        vendorName: "ACME Corporation",
        productName: "Seld-M-Break Heat Pump",
        vendorId: 0xfff1 as any,
        productId: 0x8000 as any,
        serialNumber: "1234-5665-4321",
    },
});

var heatpumpEndpoint = await node.add(HeatPumpDevice.with(HeatPumpDeviceLogic,
    PowerSourceServer.with("Wired"),
    PowerTopologyServer.with("NodeTopology"),
    ElectricalPowerMeasurementServer.with("AlternatingCurrent"),
    ElectricalEnergyMeasurementServer.with("ImportedEnergy", "CumulativeEnergy"),
    DeviceEnergyManagementServer.with("PowerForecastReporting"),
    FlowMeasurementServer
), {
    id: "heat-pump",
    // heatPump: {
    //     tagList: [PowerSourceNs.Grid],
    // },
    powerSource: {
        status: 1,
        order: 1,
        description: "Grid",
        wiredCurrentType: PowerSource.WiredCurrentType.Ac, // Alternating Current
    },
    electricalPowerMeasurement: {
        powerMode: 2,
        numberOfMeasurementTypes: 1,
        accuracy: [{
            measurementType: MeasurementType.ActivePower,
            measured: true,
            minMeasuredValue: 0,
            maxMeasuredValue: 10000,
            accuracyRanges: [{
                rangeMin: 0,
                rangeMax: 10000,
                percentMax: 100
            }],
        }],
    },
    electricalEnergyMeasurement: {
        accuracy: {
            measurementType: MeasurementType.ElectricalEnergy,
            measured: true,
            minMeasuredValue: 0,
            maxMeasuredValue: 10000,
            accuracyRanges: [{
                rangeMin: 0,
                rangeMax: 10000,
                percentMax: 100
            }],
        },
        cumulativeEnergyImported: {
            energy: 422000000,
        }
    },
    flowMeasurement: {
        measuredValue: null,
        minMeasuredValue: 0,
        maxMeasuredValue: 65533,
        // tolerance: 0, // optional
    },
    deviceEnergyManagement: {
        esaType: DeviceEnergyManagement.EsaType.SpaceHeating,
        esaState: DeviceEnergyManagement.EsaState.Online,
        absMinPower: 250000, // 250W in mW
        absMaxPower: 5000000, // 5000W in mW
        forecast: {
            forecastId: 0,
            activeSlotNumber: null,
            startTime: 0,
            endTime: 0,
            isPausable: false,
            slots: [],
            forecastUpdateReason: 0
        }
    }
});

var thermostatEndpoint = await node.add(ThermostatDevice.with(HeatPumpThermostatServer), {
    id: "heat-pump-thermostat",
    thermostat: {
        controlSequenceOfOperation: 2, // Heating only
        systemMode: 0, // Off,
        localTemperature: 2000, // 20.00 °C,
        outdoorTemperature: 1500, // 15.00 °C,
        occupiedHeatingSetpoint: 2000, // 20.00 °C,
        absMinHeatSetpointLimit: 700, // 7.00 °C,
        minHeatSetpointLimit: 700, // 7.00 °C,
        maxHeatSetpointLimit: 3000, // 30.00 °C,
        absMaxHeatSetpointLimit: 3000, // 30.00 °C,
        piHeatingDemand: 0, // Initial heating demand in percent (0-100)
    }
});

var flowSensorEndpoint = await node.add(TemperatureSensorDevice.with(TemperatureMeasurementServer), {
    id: "flow-temperature-sensor",
    temperatureMeasurement: {}
});

var now = new Date();
var currentHour = now.getHours();

var currentHeatingScheduleIndex = 0;
// var currentHotWaterScheduleIndex = 0; // Not currently used

thermostatEndpoint.events.thermostat.systemMode$Changed.on(async (value: any) => {
    await updateSystem();
});

thermostatEndpoint.events.thermostat.occupiedHeatingSetpoint$Changed.on(async (value: any) => {
    await updateSystem();
});

async function updateForecast() {

    console.log("Updating Forecast...");

    if (thermostatEndpoint.state.thermostat.systemMode == 0) {

        console.log("Heating is off, so the forecast is null");

        // Send null forecast to indicate we have no power consumption expected.
        // TODO This doesn't account for the fact the system might be switched on later in the day.
        //
        await heatpumpEndpoint.setStateOf(DeviceEnergyManagementServer, {
            forecast: null
        } as any);

    }
    else {
        // One slot per schedule period.
        //
        var slots = [];

        var powerUsagePerHour = [];

        var currentHeatingScheduleIndex = 0;

        for (let hour = currentHour; hour < 24; hour++) {

            var matchingHeatingSchedule = heatingSchedule.find(hs => hs.hour <= hour && hs.endHour >= hour);

            var matchingHeatingScheduleIndex = heatingSchedule.indexOf(matchingHeatingSchedule!);

            if (matchingHeatingScheduleIndex != currentHeatingScheduleIndex) {
                currentHeatingScheduleIndex = matchingHeatingScheduleIndex;

                if (powerUsagePerHour.length > 0) {
                    slots.push(powerUsagePerHour);
                }

                powerUsagePerHour = [];
            }

            var outdoorTemperature = (temperatureByHour.find((t: any) => t.hour == hour)?.temperature) ?? 0;

            var deltaT = (matchingHeatingSchedule?.targetTemperature ?? 20) - outdoorTemperature;

            var heatRequired = deltaT * 200;

            var weatherCurveOffset = 35;
            var weatherCurveSlope = 0.5;
            var deltaT = 5;

            var flowTemperature = (outdoorTemperature * weatherCurveSlope) + weatherCurveOffset;
            var flowRate = heatRequired / (4.186 * deltaT); // in liters per second

            var power = predict([flowTemperature, flowRate, outdoorTemperature]) * 1000; // mW;

            powerUsagePerHour.push(Math.floor(power));
        }

        slots.push(powerUsagePerHour);
        powerUsagePerHour = [];

        console.log(slots);

        // Get current unix epoc.
        //
        const today = new Date();
        today.setHours(currentHour, 0, 0, 0); // Get midnight today
        const s = today.getTime() / 1000;

        var forecastSlots: any[] = [];

        slots.forEach(slot => {

            var totalHours = slot.length;

            var averagePower = slot.reduce((a, b) => a + b, 0) / slot.length;
            var maxPower = Math.max(...slot);
            var minPower = Math.min(...slot);

            forecastSlots.push({
                minDuration: totalHours * 60 * 60,
                maxDuration: totalHours * 60 * 60,
                defaultDuration: totalHours * 60 * 60,
                elapsedSlotTime: 0,
                remainingSlotTime: s - (24 * 60 * 60),
                nominalPower: averagePower,
                minPower: minPower,
                maxPower: maxPower,
                nominalEnergy: averagePower,
            });

        });

        console.log("Publishing the forecast");

        await heatpumpEndpoint.setStateOf(DeviceEnergyManagementServer, {
            forecast: {
                forecastId: 1,
                activeSlotNumber: 0,
                startTime: s,
                endTime: s + ((24 * 60 * 60) - 1),
                isPausable: false,
                slots: forecastSlots,
                forecastUpdateReason: 0
            }
        } as any);
    }
}

logger.info(node);

await node.start();

/****
 * Load the Outdoor temperature Forecast
 ****/

console.log("Fetching weather forecast...");

const params = {
    "latitude": 52.4143,
    "longitude": -1.7809,
    "hourly": "temperature_2m",
    "timezone": "Europe/London",
    "start_date": "2024-11-28",
    "end_date": "2024-11-28",
};

const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${params.latitude}&longitude=${params.longitude}&timezone=${params.timezone}&hourly=temperature_2m&start_date=${params.start_date}&end_date=${params.end_date}`;

const response = await fetch(url);

const responseData: any = await response.json();

const hourlyData = responseData.hourly;

const temperatureByHour = hourlyData.time.map((t: any, i: number) => {
    var time = new Date(t);

    return {
        hour: time.getHours(),
        temperature: hourlyData.temperature_2m[i]
    }
});

var heatingSchedule = [
    {
        hour: 0,
        endHour: 7,
        targetTemperature: 16
    },
    {
        hour: 7,
        endHour: 22,
        targetTemperature: 21
    },
    {
        hour: 22,
        endHour: 23,
        targetTemperature: 16
    },
];

var matchingHeatingSchedule = heatingSchedule.find(hs => hs.hour <= currentHour && hs.endHour >= currentHour);
currentHeatingScheduleIndex = heatingSchedule.indexOf(matchingHeatingSchedule!);

await thermostatEndpoint.setStateOf(ThermostatServer, { occupiedHeatingSetpoint: matchingHeatingSchedule!.targetTemperature * 100 } as any);

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3001",
        methods: ["GET", "POST", "DELETE", "PUT"]
    }
});

app.get("/status", (_, response) => {
    const status = {
        status: "Running",
        systemMode: thermostatEndpoint.state.thermostat.systemMode,
        currentHour,
        targetTemperature: thermostatEndpoint.state.thermostat.occupiedHeatingSetpoint / 100,
        power: heatpumpEndpoint.state.electricalPowerMeasurement.activePower,
        activeHeatingScheduleIndex: currentHeatingScheduleIndex,
        // activeHotWaterScheduleIndex: currentHotWaterScheduleIndex // Not currently used
    };

    response.send(status);
});

app.post("/reset", async (request, response) => {
    var now = new Date();
    currentHour = now.getHours();

    await updateSystem();

    response.status(201).send();
});

app.get("/outdoortemperatures", async (request, response) => {
    response.send(temperatureByHour);
});

app.get("/heatingschedule", async (request, response) => {
    // Return the heating schedule managed locally (not from Matter cluster)
    response.send(heatingSchedule);
});

app.get("/hotwaterschedule", async (request, response) => {
    //response.send(hotWaterSchedule);
    response.send([]);
});

app.post("/on", async (request, response) => {
    console.log('Turning On...');
    await thermostatEndpoint.setStateOf(ThermostatServer, {
        systemMode: 4,
    });
    response.status(201).send();
});

app.post("/off", async (request, response) => {
    console.log('Turning Off...');
    await thermostatEndpoint.setStateOf(ThermostatServer, {
        systemMode: 0,
    });
    response.status(201).send();
});

io.on('connection', (socket) => {
    console.log('a user connected');
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server Listening on PORT:", PORT);
});

/***
 * ML - Load the linear regression model
 ***/

const data = fs.readFileSync('./model/model_params.json', 'utf8');
const modelParams = JSON.parse(data);

function predict(features: any) {
    let prediction = modelParams.intercept;
    for (let i = 0; i < features.length; i++) {
        prediction += features[i] * modelParams.coef[i];
    }
    return prediction;
}

async function updateSystem() {

    var outdoorTemperature = (temperatureByHour.find((t: any) => t.hour == currentHour)?.temperature) ?? 0;

    var targetTemperature = thermostatEndpoint.state.thermostat.occupiedHeatingSetpoint / 100;

    var deltaT = targetTemperature - outdoorTemperature;

    var heatRequired = deltaT * 300;

    var weatherCurveOffset = 35;
    var weatherCurveSlope = 0.5;
    var deltaT = 5;

    var flowTemperature = Math.abs(outdoorTemperature * weatherCurveSlope) + weatherCurveOffset;
    var flowRate = heatRequired / (4200 * deltaT); // liters per second (approx for water)

    await flowSensorEndpoint.setStateOf(TemperatureMeasurementServer, {
        measuredValue: flowTemperature * 100,
    });

    console.log({ heatRequired, flowTemperature, flowRate, outdoorTemperature });

    var power: number = 0;

    // If we're heating the house or the hot water, we're pulling power!
    //
    if (thermostatEndpoint.state.thermostat.systemMode === 4) {
        power = predict([flowTemperature, flowRate, outdoorTemperature]) * 1000; // mW;
    }

    var currentPower = Math.floor(power);

    await heatpumpEndpoint.setStateOf(ElectricalPowerMeasurementServer, {
        activePower: currentPower,
    });

    // Publish flow as Flow Measurement cluster value in 0.1 L/min units
    const litersPerMinute = flowRate * 60;
    // FlowMeasurement.MeasuredValue is uint16, spec-constrained by Min/Max; unit: 0.1 L/min
    const measuredFlow = Math.max(0, Math.min(65533, Math.round(litersPerMinute * 10)));
    await heatpumpEndpoint.setStateOf(FlowMeasurementServer, {
        measuredValue: measuredFlow,
    });
    
    // Calculate and update PIHeatingDemand
    // This is the level of heating demanded by the PI loop in percent (0-100)
    var piHeatingDemand = 0;
    if (thermostatEndpoint.state.thermostat.systemMode === 4) { // Heating mode
        const localTemp = thermostatEndpoint.state.thermostat.localTemperature;
        if (localTemp !== null) {
            const localTemperature = localTemp / 100; // Convert from 0.01°C units
            const setpoint = thermostatEndpoint.state.thermostat.occupiedHeatingSetpoint / 100;
            const temperatureDelta = setpoint - localTemperature;
            
            // Calculate demand as a percentage based on temperature delta
            // Maximum delta is assumed to be 5°C for 100% demand
            const maxDelta = 5.0;
            piHeatingDemand = Math.max(0, Math.min(100, Math.round((temperatureDelta / maxDelta) * 100)));
        }
    }
    
    await thermostatEndpoint.setStateOf(ThermostatServer, {
        piHeatingDemand: piHeatingDemand,
    } as any);

    await updateForecast();

    updateClients();
}

function updateClients() {
    io.emit('systemUpdated', {
        systemMode: thermostatEndpoint.state.thermostat.systemMode,
        currentHour,
        targetTemperature: thermostatEndpoint.state.thermostat.occupiedHeatingSetpoint / 100,
        flowTemperature: (flowSensorEndpoint.state.temperatureMeasurement.measuredValue ?? 0) / 100,
        power: heatpumpEndpoint.state.electricalPowerMeasurement.activePower,
        activeHeatingScheduleIndex: currentHeatingScheduleIndex,
        // activeHotWaterScheduleIndex: currentHotWaterScheduleIndex // Not currently used
    });
}

await updateSystem();
