"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const axios_1 = __importDefault(require("axios"));
const util_1 = require("util");
const uuid_1 = require("uuid");
const promises_1 = require("timers/promises");
const AXIOS_INTERNAL_ID_KEY = 'INTERNAL_ID';
const _buildAxios = () => {
    axios_1.default.interceptors.request.use((request) => {
        const internalId = (0, uuid_1.v4)();
        request[AXIOS_INTERNAL_ID_KEY] = internalId;
        var sRequest = `${request.method} ${request.baseURL}${request.url}`;
        if (request.params) {
            sRequest += `, parameters: ${(0, util_1.inspect)(request.params, { breakLength: Infinity, compact: true })}`;
        }
        if (request.data && !request.url.includes('login')) {
            sRequest += `, data: ${(0, util_1.inspect)(request.data, { breakLength: Infinity, compact: true })}`;
        }
        core.debug(`Registry AXIOS request ${internalId}: ${sRequest}`);
        return request;
    }, (error) => {
        core.debug(`Registry AXIOS request error: ${error}`);
        return Promise.reject(error);
    });
    axios_1.default.interceptors.response.use((response) => {
        const internalId = response.request && response.request[AXIOS_INTERNAL_ID_KEY] ? response.request[AXIOS_INTERNAL_ID_KEY] : 'Unknown';
        if (response.data && response.data.token) {
            core.setSecret(response.data.token);
        }
        var sResponse = `status: ${response.status}, status text: ${response.statusText}`;
        if (response.data) {
            sResponse += `, data: ${(0, util_1.inspect)(response.data, { breakLength: Infinity, compact: true })}`;
        }
        core.debug(`Ending AXIOS request ${internalId}: ${sResponse}`);
        return response;
    }, (error) => {
        core.debug(`AXIOS response error: ${error}`);
        return Promise.reject(error);
    });
    axios_1.default.defaults.baseURL = `https://app.nuveplatform.com/api`;
};
const _main = (args) => __awaiter(void 0, void 0, void 0, function* () {
    _buildAxios();
    const authResponse = yield axios_1.default.post(`/auth/login`, {
        email: args.email,
        password: args.password
    });
    try {
        const aCookie = authResponse.headers[`set-cookie`];
        axios_1.default.defaults.headers.common[`Cookie`] = aCookie[0];
    }
    catch (e) {
        throw new Error(`Couldn't set Cookie header: authorization failed.`);
    }
    const authCheck = yield axios_1.default.get(`/auth/check`);
    console.log(`Logged in as ${authCheck.data.name}.`);
    const backups = yield axios_1.default.get(`/organizations/${authCheck.data.slug}/backups`);
    const oBackup = backups.data.find(o => o.unique_name === args.backup);
    if (!oBackup) {
        throw new Error(`Backup ${args.backup} not found.`);
    }
    if (oBackup.status.toLowerCase() !== 'ready') {
        throw new Error(`Backup ${oBackup.unique_name} status: ${oBackup.status}.`);
    }
    const startInstance = yield axios_1.default.post(`/organizations/${authCheck.data.slug}/instances`, {
        name: args.instanceName,
        project: args.instanceProject,
        backup_id: oBackup.id
    });
    var oInstance;
    const timeoutDate = new Date((new Date()).getTime() + (args.timeout * 1000));
    core.debug(`Timeout date: ${timeoutDate.toString()}`);
    while (!oInstance || oInstance.status !== 'sap_running') {
        console.log(`Waiting for instance SAP running status...`);
        yield (0, promises_1.setTimeout)(60000);
        if ((new Date()).getTime() < timeoutDate.getTime()) {
            oInstance = (yield axios_1.default.post(`/organizations/${authCheck.data.slug}/instances/${startInstance.data.id}`)).data;
        }
        else {
            throw new Error(`Waiting for SAP running timed out after ${args.timeout} seconds.`);
        }
    }
    return {
        external_ip: oInstance.external_ip,
        sap_system_id: oInstance.backup.version.package.config.sap_system_id,
        sap_system_no: oInstance.backup.version.package.config.sap_system_no
    };
});
var timeout;
try {
    timeout = parseInt(core.getInput('timeout'));
}
catch (e) {
    core.error('Invalid timeout input value');
}
_main({
    email: core.getInput('email'),
    password: core.getInput('password'),
    backup: core.getInput('backup'),
    instanceName: core.getInput('instanceName'),
    instanceProject: core.getInput('instanceProject'),
    timeout
}).then((response) => {
    core.setOutput('externalIp', response.external_ip);
    core.setOutput('systemId', response.sap_system_id);
    core.setOutput('systemNo', response.sap_system_no);
    console.log(`SAP instance running.`);
}).catch(e => {
    var sError;
    try {
        sError = e.response.data.detail.message;
    }
    catch (er) {
        sError = e.toString();
    }
    core.error(sError);
});
//# sourceMappingURL=index.js.map