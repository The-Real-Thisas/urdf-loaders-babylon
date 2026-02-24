import { Scene, TransformNode } from '@babylonjs/core';
import { URDFRobot } from './URDFClasses';

interface MeshLoadDoneFunc {
    (mesh: TransformNode | null, err?: Error): void;
}

interface MeshLoadFunc {
    (url: string, scene: Scene | null, onLoad: MeshLoadDoneFunc): void;
}

interface LoadTracker {
    onLoad: (() => void) | null;
    itemStart(): void;
    itemEnd(): void;
    itemError(url: string): void;
}

export default class URDFLoader {

    scene: Scene | null;
    manager: LoadTracker;
    defaultMeshLoader: MeshLoadFunc;

    // options
    fetchOptions: RequestInit;
    workingPath: string;
    parseVisual: boolean;
    parseCollision: boolean;
    packages: string | { [key: string]: string } | ((targetPkg: string) => string);
    loadMeshCb: MeshLoadFunc;

    constructor(scene?: Scene | null);
    loadAsync(urdf: string): Promise<URDFRobot>;
    load(
        url: string,
        onLoad: (robot: URDFRobot) => void,
        onProgress?: ((progress?: any) => void) | null,
        onError?: ((err?: any) => void) | null
    ): void;
    parse(content: string | Element | Document): URDFRobot;

}

export * from './URDFClasses';
