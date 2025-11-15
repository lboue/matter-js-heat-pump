import { Thermostat } from "@matter/main/clusters/thermostat";
import { ThermostatServer } from "@matter/main/behaviors/thermostat";

// Thermostat.Feature.MatterScheduleConfiguration is not yet supported in the server behavior
export class HeatPumpThermostatServer extends ThermostatServer.with(Thermostat.Feature.Heating) {

    override async setpointRaiseLower(request: Thermostat.SetpointRaiseLowerRequest): Promise<void> {
        console.log("Setpoint Raise Lower called with amount:", request.amount);
    }
    
}