import * as core from "@actions/core";
import axios from 'axios';
import { inspect } from "util";
import { v4 as uuidv4 } from 'uuid';
import { setTimeout } from "timers/promises";

type ActionArguments = {
    email: string,
    password: string,
    backup: string,
    instanceName: string,
    instanceProject: string,
    timeout: number
}

type ActionResponse = {
    external_ip: string,
    sap_system_id: string,
    sap_system_no: string
}

type LoginResponse = {
    token: string
}

type AuthCheckResponse = {
    name: string,
    slug: string
}

type BackupResponse = {
    id: number,
    unique_name: string,
    status: string
}

type InstanceResponse = {
    id: number,
    status: string,
    external_ip: string,
    backup: {
        version: {
            package: {
                config: {
                    sap_system_id: string,
                    sap_system_no: string
                }
            }
        }
    }
}

const AXIOS_INTERNAL_ID_KEY = 'INTERNAL_ID';

const _buildAxios = () => {
    axios.interceptors.request.use((request) => {
        const internalId = uuidv4();
        request[AXIOS_INTERNAL_ID_KEY] = internalId;
        var sRequest = `${request.method} ${request.baseURL}${request.url}`;
        if (request.params) {
            sRequest += `, parameters: ${inspect(request.params, { breakLength: Infinity, compact: true })}`;
        }
        if (request.data && !request.url.includes('login')) {
            sRequest += `, data: ${inspect(request.data, { breakLength: Infinity, compact: true })}`;
        }
        core.debug(`Registry AXIOS request ${internalId}: ${sRequest}`);
        return request;
    }, (error) => {
        core.debug(`Registry AXIOS request error: ${error}`);
        return Promise.reject(error);
    });
    axios.interceptors.response.use((response) => {
        const internalId = response.request && response.request[AXIOS_INTERNAL_ID_KEY] ? response.request[AXIOS_INTERNAL_ID_KEY] : 'Unknown';
        if(response.data && response.data.token){
            //MIW: secret in response, avoid leak
            core.setSecret(response.data.token);
        }
        var sResponse = `status: ${response.status}, status text: ${response.statusText}`;
        if (response.data) {
            sResponse += `, data: ${inspect(response.data, { breakLength: Infinity, compact: true })}`;
        }
        core.debug(`Ending AXIOS request ${internalId}: ${sResponse}`);
        return response;
    }, (error) => {
        core.debug(`AXIOS response error: ${error}`);
        return Promise.reject(error);
    });
    axios.defaults.baseURL = `https://app.nuveplatform.com/api`;
}

const _main = async (args: ActionArguments): Promise<ActionResponse> => {
    _buildAxios();
    const authResponse = await axios.post<LoginResponse>(`/auth/login`, {
        email: args.email,
        password: args.password
    });
    try {
        const aCookie = authResponse.headers[`set-cookie`];
        axios.defaults.headers.common[`Cookie`] = aCookie[0];
    } catch (e) {
        throw new Error(`Couldn't set Cookie header: authorization failed.`);
    }
    const authCheck = await axios.get<AuthCheckResponse>(`/auth/check`);
    console.log(`Logged in as ${authCheck.data.name}.`);
    const backups = await axios.get<BackupResponse[]>(`/organizations/${authCheck.data.slug}/backups`);
    const oBackup = backups.data.find(o => o.unique_name === args.backup);
    if (!oBackup) {
        throw new Error(`Backup ${args.backup} not found.`);
    }
    if (oBackup.status.toLowerCase() !== 'ready') {
        throw new Error(`Backup ${oBackup.unique_name} status: ${oBackup.status}.`);
    }
    const startInstance = await axios.post<InstanceResponse>(`/organizations/${authCheck.data.slug}/instances`, {
        name: args.instanceName,
        project: args.instanceProject,
        backup_id: oBackup.id
    });
    var oInstance: InstanceResponse;
    const timeoutDate = new Date((new Date()).getTime() + (args.timeout * 1000));
    core.debug(`Timeout date: ${timeoutDate.toString()}`);
    while(!oInstance || (oInstance && oInstance.status !== 'sap_running')){
        console.log(`Waiting for instance SAP running status...`);
        await setTimeout(60000);
        if((new Date()).getTime() < timeoutDate.getTime()){
            oInstance = (await axios.post<InstanceResponse>(`/organizations/${authCheck.data.slug}/instances/${startInstance.data.id}`)).data;
        }else{
            throw new Error(`Waiting for SAP running timed out after ${args.timeout} seconds.`);
        }
    }
    return {
        external_ip: oInstance.external_ip,
        sap_system_id: oInstance.backup.version.package.config.sap_system_id,
        sap_system_no: oInstance.backup.version.package.config.sap_system_no
    }
}

var timeout: number;
try{
    timeout = parseInt(core.getInput('timeout'));
}catch(e){
    core.error('Invalid timeout input value');
}

_main({
    email: core.getInput('email'),
    password: core.getInput('password'),
    backup: core.getInput('backup'),
    instanceName: core.getInput('instanceName'),
    instanceProject: core.getInput('instanceProject'),
    timeout
}).then((response: ActionResponse) => {
    core.setOutput('externalIp', response.external_ip);
    core.setOutput('systemId', response.sap_system_id);
    core.setOutput('systemNo', response.sap_system_no);
    console.log(`SAP instance running.`);
}).catch(e => {
    var sError: string;
    try {
        sError = e.response.data.detail.message;
    } catch (er) {
        sError = e.toString();
    }
    core.error(sError);
});