import express from "express";
import http from "http"
import { Server } from "socket.io";
import cors from "cors";
import { ServerNode, Logger, Bytes } from "@matter/main";
import { MeasurementType } from "@matter/main/types";
import { HeatPumpDevice } from "@matter/main/devices/heat-pump";
import { ThermostatDevice } from "@matter/main/devices/thermostat";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor"
import { FlowSensorDevice } from "@matter/main/devices/flow-sensor"
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
import { DescriptorServer } from "@matter/main/behaviors/descriptor";

// Tags
import { NumberTag, PowerSourceTag } from '@matter/node';

// Clusters
import { PowerSource } from "@matter/main/clusters/power-source";
import { Thermostat } from "@matter/main/clusters/thermostat";
import { DeviceEnergyManagementMode } from "@matter/main/clusters/device-energy-management-mode";

import fs from "fs";
import { DeviceEnergyManagementModeServer } from "@matter/main/behaviors/device-energy-management-mode";

const logger = Logger.get("ComposedDeviceNode");

// Initialize Socket.IO reference early to avoid TDZ issues in callbacks
let io: Server | undefined;

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
    DescriptorServer.with("TagList"),
    PowerSourceServer.with("Wired"),
    PowerTopologyServer.with("NodeTopology"),
    ElectricalPowerMeasurementServer.with("AlternatingCurrent"),
    ElectricalEnergyMeasurementServer.with("ImportedEnergy", "CumulativeEnergy"),
    DeviceEnergyManagementServer.with("PowerForecastReporting"),
    DeviceEnergyManagementModeServer,
), {
    id: "heat-pump",
    descriptor: {
        tagList: [
            {
                mfgCode: null,
                namespaceId: PowerSourceTag.Grid.namespaceId,
                tag: PowerSourceTag.Grid.tag,
            },
        ],
    },    
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
            energy: 1000 * 1000,  // in 0.001 kWh units (i.e., 1,000 kWh
        }
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
    },
    // DeviceEnergyManagementModeServer
    // Use ModeBase-style definitions: each supported mode needs a numeric mode id and label.
    deviceEnergyManagementMode: {
        currentMode: 0,
        supportedModes: [
            {
                label: "No optimization",
                mode: 0,
                modeTags: [{ value: DeviceEnergyManagementMode.ModeTag.NoOptimization }],
            },
            {
                label: "Local optimization",
                mode: 1,
                modeTags: [{ value: DeviceEnergyManagementMode.ModeTag.LocalOptimization }],
            },
            {
                label: "Grid optimization",
                mode: 2,
                modeTags: [{ value: DeviceEnergyManagementMode.ModeTag.GridOptimization }],
            },
        ],
    }

});

var thermostatEndpoint = await node.add(ThermostatDevice.with(HeatPumpThermostatServer), {
    id: "heat-pump-thermostat",
    thermostat: {
        controlSequenceOfOperation: 2, // Heating only
        systemMode: 0, // Off,
        localTemperature: 1800, // 18.00 °C (initial default)
        externalMeasuredIndoorTemperature: 1800, // Provide a default so localTemperature is not nulled
        outdoorTemperature: 1500, // 15.00 °C,
        occupiedHeatingSetpoint: 2000, // 20.00 °C,
        absMinHeatSetpointLimit: 700, // 7.00 °C,
        minHeatSetpointLimit: 700, // 7.00 °C,
        maxHeatSetpointLimit: 3000, // 30.00 °C,
        absMaxHeatSetpointLimit: 3000, // 30.00 °C,
        temperatureSetpointHold: Thermostat.TemperatureSetpointHold.SetpointHoldOff, // Follow scheduling program
        temperatureSetpointHoldDuration: null, // TODO: update when hold is active
        setpointHoldExpiryTimestamp: null,
        thermostatProgrammingOperationMode: { scheduleActive: true, autoRecovery: true },
        piHeatingDemand: 0, // Initial heating demand in percent (0-100)
        // Matter Schedule Configuration extension attributes
        scheduleTypes: [{
            systemMode: 4, // Heating,
            numberOfSchedules: 10,
            scheduleTypeFeatures: {
                supportsSetpoints: true,
            }
        }],
        numberOfSchedules: 1,
        numberOfScheduleTransitions: 5,
        activeScheduleHandle: Bytes.fromHex("0001"),
        schedules: [{
            scheduleHandle: Bytes.fromHex("0001"),
            systemMode: 4,
            name: "Default Heating Schedule",
            transitions: [{
                dayOfWeek: {
                    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true
                },
                heatingSetpoint: 2100,
                transitionTime: 330,
                systemMode: 4
            },
            {
                dayOfWeek: {
                    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true
                },
                heatingSetpoint: 1600,
                transitionTime: 1380,
                systemMode: 4
            }],
            builtIn: true,
        }],
        // setpointChange 
        setpointChangeSource: Thermostat.SetpointChangeSource.Manual, // Default: Manual
        setpointChangeAmount: null, // Default: null
        setpointChangeSourceTimestamp: 0, // Default: 0
        thermostatRunningState: { heat: false, cool: false, fan: false, heatStage2: false, coolStage2: false, fanStage2: false, fanStage3: false }, // Initial: all flags off
    }
});

var flowSensorEndpoint = await node.add(TemperatureSensorDevice.with(TemperatureMeasurementServer, DescriptorServer.with("TagList")), {
    id: "flow-temperature-sensor",
    temperatureMeasurement: {},
    // Expose a tag on the Descriptor cluster for this endpoint
    descriptor: {
        tagList: [
            {
                mfgCode: null,
                namespaceId: NumberTag.One.namespaceId,
                tag: NumberTag.One.tag,
                label: "Flow",
            },
        ],
    }

});

// New endpoint: Flow sensor publishing FlowMeasurement cluster
// tagList: [{ mfgCode: null, namespaceId: NumberTag.One.namespaceId, tag: NumberTag.One.tag, label: 'Flow' }],
var flowMeterEndpoint = await node.add(FlowSensorDevice.with(FlowMeasurementServer, DescriptorServer.with("TagList")), {
    id: "flow-sensor",
    flowMeasurement: {
        measuredValue: null,
        minMeasuredValue: 0,
        maxMeasuredValue: 65533,
    },
    // Expose a tag on the Descriptor cluster for this endpoint
    descriptor: {
        tagList: [
            {
                mfgCode: null,
                namespaceId: NumberTag.One.namespaceId,
                tag: NumberTag.One.tag,
                label: "Flow",
            },
        ],
    }
});

var now = new Date();
var currentHour = now.getHours();

var currentHeatingScheduleIndex = 0;
// var currentHotWaterScheduleIndex = 0; // Not currently used

// Track previous setpoint to calculate change amount
var previousSetpoint = 2000; // Initial default value
var isUpdatingSetpointAttributes = false; // Prevent recursive updates

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
        // Set flowMeterEndpoint measuredValue to zero when heating is off
        await flowMeterEndpoint.setStateOf(FlowMeasurementServer, {
            measuredValue: 0
        });
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

// Initialize the setpoint based on current schedule
previousSetpoint = matchingHeatingSchedule!.targetTemperature * 100;
await thermostatEndpoint.setStateOf(ThermostatServer, { occupiedHeatingSetpoint: previousSetpoint } as any);
// Reinforce a default indoor temperature after initialization
await thermostatEndpoint.setStateOf(ThermostatServer, { localTemperature: 1800 } as any);

// Register event handlers AFTER node is started and endpoints are initialized
thermostatEndpoint.events.thermostat.systemMode$Changed.on(async (value: any) => {
    await updateSystem();
});

thermostatEndpoint.events.thermostat.occupiedHeatingSetpoint$Changed.on(async (value: any) => {
    // Prevent recursive updates when we're setting attributes ourselves
    if (isUpdatingSetpointAttributes) {
        console.log('Skipping event handler due to internal update');
        return;
    }
    
    // Calculate the change amount (new value - previous value)
    const changeAmount = value - previousSetpoint;
    
    console.log(`Setpoint changed from ${previousSetpoint} to ${value}, change amount: ${changeAmount}`);
    
    // Update previous setpoint for next change
    previousSetpoint = value;
    
    // When setpoint is manually changed, enable setpoint hold to override the schedule
    isUpdatingSetpointAttributes = true;
    let holdDuration = 30; // Hold for 30 minutes
    try {
        await thermostatEndpoint.setStateOf(ThermostatServer, {
            temperatureSetpointHold: Thermostat.TemperatureSetpointHold.SetpointHoldOn,
            temperatureSetpointHoldDuration: holdDuration,
            setpointHoldExpiryTimestamp: Math.floor(Date.now() / 1000) + (holdDuration * 60), // Current time + holdDuration minutes
            setpointChangeSource: Thermostat.SetpointChangeSource.Manual,
            setpointChangeAmount: changeAmount,
            setpointChangeSourceTimestamp: Math.floor(Date.now() / 1000),
        } as any);
        console.log('Setpoint hold attributes updated successfully');
        console.log(`Setpoint hold expiry timestamp: ${Math.floor(Date.now() / 1000) + (holdDuration * 60)}`);
    } finally {
        isUpdatingSetpointAttributes = false;
    }
    
    await updateSystem();
});

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
io = new Server(server, {
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
        piHeatingDemand: thermostatEndpoint.state.thermostat.piHeatingDemand,
        thermostatRunningState: thermostatEndpoint.state.thermostat.thermostatRunningState,
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
 * ML - Load the linear regression model (lazy to avoid TDZ issues)
 ***/

let modelParams: any | null = null;

function ensureModelLoaded() {
    if (!modelParams) {
        try {
            const data = fs.readFileSync('./model/model_params.json', 'utf8');
            modelParams = JSON.parse(data);
        } catch {
            modelParams = { intercept: 0, coef: [] };
        }
    }
}

function predict(features: any) {
    ensureModelLoaded();
    const params = modelParams as any;
    let prediction = params.intercept ?? 0;
    const coefs = Array.isArray(params.coef) ? params.coef : [];
    for (let i = 0; i < features.length; i++) {
        const c = coefs[i] ?? 0;
        prediction += features[i] * c;
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

    // Update outdoor temperature on thermostat
    await thermostatEndpoint.setStateOf(ThermostatServer, {
        outdoorTemperature: outdoorTemperature * 100, // Convert to 0.01°C units
    } as any);

    console.log({ heatRequired, flowTemperature, flowRate, outdoorTemperature });

    // Calculate and update PIHeatingDemand first
    // This is the level of heating demanded by the PI loop in percent (0-100)
    var piHeatingDemand = 0;
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

    var power: number = 0;

    // Compute power based on heating mode and demand
    if (thermostatEndpoint.state.thermostat.systemMode === 4) {
        // Heating mode: use full predicted power
        power = predict([flowTemperature, flowRate, outdoorTemperature]) * 1000; // mW;
    } else {
        // System off: show potential power based on PI demand (for monitoring/UI feedback)
        const potentialPower = predict([flowTemperature, flowRate, outdoorTemperature]) * 1000;
        power = (potentialPower * piHeatingDemand) / 100;
    }

    var currentPower = Math.floor(power);

    await heatpumpEndpoint.setStateOf(ElectricalPowerMeasurementServer, {
        activePower: currentPower,
    });

    // Update PIHeatingDemand and ThermostatRunningState (calculated earlier in this function)
    // ThermostatRunningState bitmap: bit 0 = Heat State On (0x01), bit 1 = Cool State On (0x02)
    // Running when system is in heating mode and there's demand
    const isHeating = thermostatEndpoint.state.thermostat.systemMode === 4 && piHeatingDemand > 0;
    const thermostatRunningState = { heat: isHeating, cool: false, fan: false, heatStage2: false, coolStage2: false, fanStage2: false, fanStage3: false };
    
    await thermostatEndpoint.setStateOf(ThermostatServer, {
        piHeatingDemand: piHeatingDemand,
        thermostatRunningState: thermostatRunningState,
    } as any);

    // Publish flow as Flow Measurement only when heating is running
    // Unit: 0.1 L/min, uint16, constrained by Min/Max
    {
        const litersPerMinute = flowRate * 60;
        const measuredFlow = isHeating
            ? Math.max(0, Math.min(65533, Math.round(litersPerMinute * 10)))
            : 0; // No heating -> no flow
        await flowMeterEndpoint.setStateOf(FlowMeasurementServer, {
            measuredValue: measuredFlow,
        });
    }

    await updateForecast();

    updateClients();
}

function updateClients() {
    if (!io) return;
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

// Apply the heating schedule at the start of each hour
var lastScheduleAppliedHour = currentHour;

async function applyScheduleForCurrentHour() {
    const now = new Date();
    const hour = now.getHours();

    if (hour !== lastScheduleAppliedHour) {
        currentHour = hour;

        const matching = heatingSchedule.find(hs => hs.hour <= currentHour && hs.endHour >= currentHour);
        if (matching) {
            currentHeatingScheduleIndex = heatingSchedule.indexOf(matching);
            const newSetpoint = matching.targetTemperature * 100;
            
            // Update previousSetpoint for next manual change
            previousSetpoint = newSetpoint;
            
            // When schedule is automatically applied, turn off setpoint hold
            // Set flag to prevent the occupiedHeatingSetpoint$Changed handler from interfering
            isUpdatingSetpointAttributes = true;
            try {
                await thermostatEndpoint.setStateOf(ThermostatServer, { 
                    occupiedHeatingSetpoint: newSetpoint,
                    temperatureSetpointHold: Thermostat.TemperatureSetpointHold.SetpointHoldOff,
                    setpointChangeSource: Thermostat.SetpointChangeSource.Schedule,
                    setpointChangeAmount: null,
                    setpointChangeSourceTimestamp: Math.floor(Date.now() / 1000),
                } as any);
            } finally {
                isUpdatingSetpointAttributes = false;
            }
            await updateSystem();
        }

        lastScheduleAppliedHour = hour;
    }
}

setInterval(() => { void applyScheduleForCurrentHour(); }, 60 * 1000);
