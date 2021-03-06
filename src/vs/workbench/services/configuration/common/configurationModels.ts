/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { clone } from 'vs/base/common/objects';
import { CustomConfigurationModel, toValuesTree } from 'vs/platform/configuration/common/model';
import { ConfigurationModel } from 'vs/platform/configuration/common/configuration';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, IConfigurationPropertySchema, Extensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { WORKSPACE_STANDALONE_CONFIGURATIONS } from 'vs/workbench/services/configuration/common/configuration';

export class ScopedConfigurationModel<T> extends CustomConfigurationModel<T> {

	constructor(content: string, name: string, public readonly scope: string) {
		super(null, name);
		this.update(content);
	}

	public update(content: string): void {
		super.update(content);
		const contents = Object.create(null);
		contents[this.scope] = this.contents;
		this._contents = contents;
	}

}

export class FolderSettingsModel<T> extends CustomConfigurationModel<T> {

	private _raw: T;
	private _unsupportedKeys: string[];

	protected processRaw(raw: T): void {
		this._raw = raw;
		const processedRaw = <T>{};
		this._unsupportedKeys = [];
		const configurationProperties = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties();
		for (let key in raw) {
			if (this.isNotExecutable(key, configurationProperties)) {
				processedRaw[key] = raw[key];
			} else {
				this._unsupportedKeys.push(key);
			}
		}
		return super.processRaw(processedRaw);
	}

	public reprocess(): void {
		this.processRaw(this._raw);
	}

	public get unsupportedKeys(): string[] {
		return this._unsupportedKeys || [];
	}

	private isNotExecutable(key: string, configurationProperties: { [qualifiedKey: string]: IConfigurationPropertySchema }): boolean {
		const propertySchema = configurationProperties[key];
		if (!propertySchema) {
			return true; // Unknown propertis are ignored from checks
		}
		return !propertySchema.isExecutable;
	}

	public createWorkspaceConfigurationModel(): ConfigurationModel<any> {
		return this.createScopedConfigurationModel(ConfigurationScope.WORKSPACE);
	}

	public createFolderScopedConfigurationModel(): ConfigurationModel<any> {
		return this.createScopedConfigurationModel(ConfigurationScope.FOLDER);
	}

	private createScopedConfigurationModel(scope: ConfigurationScope): ConfigurationModel<any> {
		const workspaceRaw = <T>{};
		const configurationProperties = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties();
		for (let key in this._raw) {
			if (this.getScope(key, configurationProperties) === scope) {
				workspaceRaw[key] = this._raw[key];
			}
		}
		const workspaceContents = toValuesTree(workspaceRaw, message => console.error(`Conflict in workspace settings file: ${message}`));
		const workspaceKeys = Object.keys(workspaceRaw);
		return new ConfigurationModel(workspaceContents, workspaceKeys, clone(this._overrides));
	}

	private getScope(key: string, configurationProperties: { [qualifiedKey: string]: IConfigurationPropertySchema }): ConfigurationScope {
		const propertySchema = configurationProperties[key];
		return propertySchema ? propertySchema.scope : ConfigurationScope.WORKSPACE;
	}
}

export class FolderConfigurationModel<T> extends CustomConfigurationModel<T> {

	constructor(public readonly workspaceSettingsConfig: FolderSettingsModel<T>, private scopedConfigs: ScopedConfigurationModel<T>[], private scope: ConfigurationScope) {
		super();
		this.consolidate();
	}

	private consolidate(): void {
		this._contents = <T>{};
		this._overrides = [];

		this.doMerge(this, ConfigurationScope.WORKSPACE === this.scope ? this.workspaceSettingsConfig : this.workspaceSettingsConfig.createFolderScopedConfigurationModel());
		for (const configModel of this.scopedConfigs) {
			this.doMerge(this, configModel);
		}
	}

	public get keys(): string[] {
		const keys: string[] = [...this.workspaceSettingsConfig.keys];
		this.scopedConfigs.forEach(scopedConfigModel => {
			Object.keys(WORKSPACE_STANDALONE_CONFIGURATIONS).forEach(scope => {
				if (scopedConfigModel.scope === scope) {
					keys.push(...scopedConfigModel.keys.map(key => `${scope}.${key}`));
				}
			});
		});
		return keys;
	}

	public update(): void {
		this.workspaceSettingsConfig.reprocess();
		this.consolidate();
	}
}