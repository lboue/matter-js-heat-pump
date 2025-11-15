import { Behavior, ElectricalMeasurementTag, Node } from "@matter/main";
import { Thermostat } from "@matter/main/clusters/thermostat";
import { HeatPumpThermostatServer } from "./HeatPumpThermostatServer.js";
import { ElectricalPowerMeasurementServer } from "@matter/main/behaviors/electrical-power-measurement";

export class HeatPumpDeviceLogic extends Behavior {
    static override readonly id = "heatPumpDeviceLogic";
    static override readonly early = true;

    override async initialize() {
        // Delay setting up all the listeners to make sure we have a clean state
        this.reactTo((this.endpoint as Node).lifecycle.partsReady, this.#initializeNode);
    }

    async #initializeNode() {
        // Access the thermostat endpoint from the parent node
        const node = this.endpoint.owner as Node;
        const thermostatEndpoint = node.parts.get("heat-pump-thermostat");
        
        if (thermostatEndpoint) {
            // Use actWith to access the thermostat behavior
            await thermostatEndpoint.act(async agent => {
                const thermostat = agent.get(HeatPumpThermostatServer);
                
                this.reactTo(thermostat.events.systemMode$Changed, this.#handleSystemModeChanged, {
                    offline: true,
                });
                this.reactTo(thermostat.events.occupiedHeatingSetpoint$Changed, this.#handleOccupiedHeatingSetpointChanged, {
                    offline: true,
                });
            });
        }
    }

    async #handleSystemModeChanged(newMode: Thermostat.SystemMode, oldMode: Thermostat.SystemMode) {
        console.log("System Mode changed to:", newMode);
    }

    async #handleOccupiedHeatingSetpointChanged(newMode: number, oldMode: number) {
        console.log("Occupied Heating Setpoint changed to:", newMode);
    }

    async setActivePower(power: number) {

        this.endpoint.setStateOf(ElectricalPowerMeasurementServer, {
            activePower: power
        })

    }
}   