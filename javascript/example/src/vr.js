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
    Vector3,
    Mesh,
    Quaternion,
    SceneLoader,
    WebXRDefaultExperience,
} from '@babylonjs/core';
import '@babylonjs/loaders/STL';
import '@babylonjs/loaders/glTF';
import URDFLoader from '../../src/URDFLoader.js';
import { URDFDragControls } from '../../src/URDFDragControls.js';

let scene, camera, engine, robot;
let dragControls;

init();

async function init() {

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    document.body.appendChild(canvas);

    engine = new Engine(canvas, true);
    scene = new Scene(engine);
    scene.clearColor = new Color3(1.0, 0.67, 0.25);

    camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 5, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);

    const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -6, -1), scene);
    dirLight.intensity = 3.0;
    dirLight.position = new Vector3(5, 30, 5);
    const shadowGenerator = new ShadowGenerator(2048, dirLight);
    shadowGenerator.useBlurExponentialShadowMap = true;

    const ambientLight = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    ambientLight.diffuse = new Color3(1.0, 0.72, 0.3);
    ambientLight.intensity = 1.0;

    const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = Color3.Black();
    groundMat.alpha = 0.1;
    ground.material = groundMat;
    ground.receiveShadows = true;

    // Hover material for drag controls
    const hoverMaterial = new StandardMaterial('hoverMat', scene);
    hoverMaterial.emissiveColor = new Color3(1.0, 0.67, 0.25);

    dragControls = new URDFDragControls(scene);
    dragControls.babylonScene = scene;
    dragControls.onHover = joint => {

        const traverse = c => {

            if (c !== joint && c.isURDFJoint && c.jointType !== 'fixed') return;

            if (c instanceof Mesh) {

                c.__originalMaterial = c.material;
                c.material = hoverMaterial;

            }

            if (c.getChildren) c.getChildren().forEach(traverse);

        };
        traverse(joint);

    };
    dragControls.onUnhover = joint => {

        const traverse = c => {

            if (c !== joint && c.isURDFJoint && c.jointType !== 'fixed') return;

            if (c instanceof Mesh) {

                c.material = c.__originalMaterial;

            }

            if (c.getChildren) c.getChildren().forEach(traverse);

        };
        traverse(joint);

    };

    // Load robot
    const loader = new URDFLoader(scene);
    loader.loadMeshCb = function(path, loaderScene, onComplete) {
        const ext = path.split(/\./g).pop().toLowerCase();
        const rootUrl = path.substring(0, path.lastIndexOf('/') + 1);
        const fileName = path.substring(path.lastIndexOf('/') + 1);

        switch (ext) {

            case 'gltf':
            case 'glb':
                SceneLoader.ImportMesh('', rootUrl, fileName, loaderScene, (meshes) => {

                    if (meshes.length === 1) onComplete(meshes[0]);
                    else if (meshes.length > 1) {

                        const parent = new Mesh('gltf-root', loaderScene);
                        meshes.forEach(m => { m.parent = parent; });
                        onComplete(parent);

                    }

                }, null, (s, msg, err) => onComplete(null, err || new Error(msg)));
                break;
            default:
                loader.defaultMeshLoader(path, loaderScene, onComplete);

        }

    };

    loader.manager.onLoad = () => {

        robot.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);
        robot.traverse(c => {
            if (c instanceof Mesh) {

                shadowGenerator.addShadowCaster(c);
                c.receiveShadows = true;

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

    // WebXR setup
    try {

        const xr = await WebXRDefaultExperience.CreateAsync(scene, {
            floorMeshes: [ground],
        });

        // The WebXR experience provides basic VR interaction
        console.log('WebXR experience created');

    } catch (e) {

        console.warn('WebXR not available:', e);

    }

    window.addEventListener('resize', () => engine.resize());
    engine.resize();

    engine.runRenderLoop(() => {

        scene.render();

    });

}
