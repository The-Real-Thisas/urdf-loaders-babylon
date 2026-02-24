import {
    Engine,
    Scene,
    ArcRotateCamera,
    DirectionalLight,
    HemisphericLight,
    ShadowGenerator,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Color4,
    Vector3,
    Mesh,
} from '@babylonjs/core';
import { STLFileLoader } from '@babylonjs/loaders/STL/stlFileLoader.js';
import '@babylonjs/loaders/glTF';

STLFileLoader.DO_NOT_ALTER_FILE_COORDINATES = true;
import URDFLoader from '../../src/URDFLoader.js';

let scene, camera, engine, robot;

init();

function init() {

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    document.body.appendChild(canvas);

    engine = new Engine(canvas, true);
    scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.149, 0.196, 0.220, 1.0);

    camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 15, Vector3.Zero(), scene);
    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.lowerRadiusLimit = 4;
    camera.attachControl(canvas, true);
    camera.target.y = 1;

    const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -6, -1), scene);
    dirLight.intensity = 1.0;
    dirLight.position = new Vector3(5, 30, 5);

    const shadowGenerator = new ShadowGenerator(1024, dirLight);
    shadowGenerator.useBlurExponentialShadowMap = true;

    const ambientLight = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    ambientLight.intensity = 0.2;

    const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = Color3.Black();
    groundMat.specularColor = Color3.Black();
    groundMat.alpha = 0.25;
    ground.material = groundMat;
    ground.receiveShadows = true;

    // Load robot
    const loader = new URDFLoader(scene);
    loader.manager.onLoad = () => {

        // Rotate so the robot is upright (URDF Z-up -> Babylon Y-up)
        robot.rotationQuaternion = null;
        robot.rotation.x = Math.PI / 2;

        robot.traverse(c => {
            if (c instanceof Mesh) {

                shadowGenerator.addShadowCaster(c);

            }
        });

        const DEG2RAD = Math.PI / 180;
        for (let i = 1; i <= 6; i++) {

            robot.joints[`HP${ i }`].setJointValue(30 * DEG2RAD);
            robot.joints[`KP${ i }`].setJointValue(120 * DEG2RAD);
            robot.joints[`AP${ i }`].setJointValue(-60 * DEG2RAD);

        }

    };
    loader.load('../../../urdf/T12/urdf/T12_flipped.URDF', result => {

        robot = result;

    });

    window.addEventListener('resize', onResize);
    onResize();

    engine.runRenderLoop(() => {

        scene.render();

    });

}

function onResize() {

    engine.resize();

}
