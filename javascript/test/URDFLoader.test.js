import { JSDOM } from 'jsdom';
import { NullEngine, Scene, Mesh, StandardMaterial, Color3 } from '@babylonjs/core';
import fetch from 'node-fetch';
import URDFLoader from '../src/URDFLoader.js';

const jsdom = new JSDOM();
const window = jsdom.window;
global.DOMParser = window.DOMParser;
global.XMLSerializer = window.XMLSerializer;
global.Document = window.Document;
global.Element = window.Element;
global.XMLHttpRequest = window.XMLHttpRequest;
global.fetch = fetch;

const engine = new NullEngine();
const testScene = new Scene(engine);

function emptyLoadMeshCallback(url, scene, done) {

    done(new Mesh('empty', testScene));

}

function compareRobots(ra, rb) {

    if (ra.isURDFRobot) {

        expect(Object.keys(ra.links).sort()).toEqual(Object.keys(rb.links).sort());
        expect(Object.keys(ra.joints).sort()).toEqual(Object.keys(rb.joints).sort());
        expect(Object.keys(ra.colliders).sort()).toEqual(Object.keys(rb.colliders).sort());
        expect(Object.keys(ra.visual).sort()).toEqual(Object.keys(rb.visual).sort());

    }

    expect(ra.name).toEqual(rb.name);
    expect(ra.type).toEqual(rb.type);
    expect(ra.urdfNode).toEqual(rb.urdfNode);
    expect(ra.urdfName).toEqual(rb.urdfName);

    expect(ra.isURDFLink).toEqual(rb.isURDFLink);
    expect(ra.isURDFRobot).toEqual(rb.isURDFRobot);
    expect(ra.isURDFJoint).toEqual(rb.isURDFJoint);
    expect(ra.isURDFCollider).toEqual(rb.isURDFCollider);

    switch (ra.type) {

        case 'URDFRobot':
            expect(Object.keys(ra.joints)).toEqual(Object.keys(rb.joints));
            expect(Object.keys(ra.links)).toEqual(Object.keys(rb.links));
            break;

        case 'URDFJoint':
        case 'URDFMimicJoint':
            expect(ra.jointType).toEqual(rb.jointType);
            expect(ra.axis.x).toBeCloseTo(rb.axis.x);
            expect(ra.axis.y).toBeCloseTo(rb.axis.y);
            expect(ra.axis.z).toBeCloseTo(rb.axis.z);
            expect(ra.limit).toEqual(rb.limit);
            expect(ra.ignoreLimits).toEqual(rb.ignoreLimits);
            expect(ra.jointValue).toEqual(rb.jointValue);

            // Just compare the names of the mimic joint list
            expect(ra.mimicJoints.map(x => x.urdfName)).toEqual(rb.mimicJoints.map(x => x.urdfName));

            if (ra.type === 'URDFMimicJoint') {

                expect(ra.mimicJoint).toEqual(rb.mimicJoint);
                expect(ra.offset).toEqual(rb.offset);
                expect(ra.multiplier).toEqual(rb.multiplier);

            }

            break;

    }

    const raChildren = ra.getChildren();
    const rbChildren = rb.getChildren();
    for (let i = 0; i < raChildren.length; i++) {

        compareRobots(raChildren[i], rbChildren[i]);

    }

}

describe('File Argument', () => {

    it('should work if the file is already parsed', async() => {

        const loader = new URDFLoader(testScene);
        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing';
        loader.workingPath = 'https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/';

        const req = await fetch('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/TriATHLETE.URDF');
        const xmlContent = await req.text();
        const parsedContent = new DOMParser().parseFromString(xmlContent, 'text/xml');

        const documentRobot = loader.parse(parsedContent);
        const rootRobot = loader.parse(parsedContent.children[0]);

        expect(Object.keys(documentRobot.links).length).toEqual(28);
        expect(Object.keys(rootRobot.links).length).toEqual(28);

    });

});

describe('Options', () => {

    describe('parseVisual, parseCollision', () => {

        it('should exclude the elements if false', async() => {

            const loader = new URDFLoader(testScene);
            loader.packages = 'https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/';
            loader.loadMeshCb = emptyLoadMeshCallback;
            loader.parseVisual = false;
            loader.parseCollision = false;

            let visTotal = 0;
            let colTotal = 0;
            const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/r2_description/robots/r2b.urdf');
            robot.traverse(c => {

                if (c.isURDFCollider) {

                    colTotal++;

                }

                if (c.isURDFVisual) {

                    visTotal++;

                }

            });

            expect(visTotal).toBe(0);
            expect(colTotal).toBe(0);

        });

        it('should include the elements if true', async() => {

            const loader = new URDFLoader(testScene);
            loader.packages = 'https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/';
            loader.loadMeshCb = emptyLoadMeshCallback;
            loader.parseVisual = true;
            loader.parseCollision = true;

            let visTotal = 0;
            let colTotal = 0;
            const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/r2_description/robots/r2b.urdf');
            robot.traverse(c => {

                if (c.isURDFCollider) {

                    colTotal++;

                }

                if (c.isURDFVisual) {

                    visTotal++;

                }

            });

            expect(visTotal).toBe(71);
            expect(colTotal).toBe(71);

        });

    });

    describe('loadMeshCb', () => {

        it('should get called to load all meshes', async() => {

            const loader = new URDFLoader(testScene);
            loader.packages = 'https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing';
            loader.loadMeshCb = (path, scene, done) => {

                const mesh = new Mesh('fromCb', testScene);
                mesh.fromCallback = true;
                done(mesh);

            };

            let fromCallbackCount = 0;
            const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/TriATHLETE.URDF');
            robot.traverse(c => {

                if (c.fromCallback) {

                    fromCallbackCount++;

                }

            });

            expect(fromCallbackCount).toEqual(28);

        });

        it('should use correct workingPath to load meshes', async() => {

            const loader = new URDFLoader(testScene);

            loader.workingPath = 'https://raw.githubusercontent.com/mock-working-path';
            loader.loadMeshCb = (path, scene, done) => {

                const mesh = new Mesh('empty', testScene);
                expect(path).toContain('https://raw.githubusercontent.com/mock-working-path');
                done(mesh);

            };
            await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/TriATHLETE.URDF');

            loader.workingPath = '';
            loader.loadMeshCb = (path, scene, done) => {

                const mesh = new Mesh('empty', testScene);
                expect(path).toContain('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf');
                done(mesh);

            };
            await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/TriATHLETE.URDF');

            expect(loader.workingPath).toBe('');
        });

    });

    describe('packages', () => {

        const urdf = `
            <robot>
                <link name="Body">
                    <visual>
                        <origin xyz="0 0 0" rpy="0 0 0" />
                        <geometry>
                            <mesh filename="package://package1/path/to/model.stl" />
                        </geometry>
                    </visual>
                </link>
                <link name="Body">
                    <visual>
                        <origin xyz="0 0 0" rpy="0 0 0" />
                        <geometry>
                            <mesh filename="package://package2/path/to/model2.stl" />
                        </geometry>
                    </visual>
                </link>
            </robot>
        `;

        it('should use the values from an object if set.', () => {

            const loader = new URDFLoader(testScene);
            loader.packages = {
                'package1': 'path/to/package1',
                'package2': 'path/to/package2',
            };

            const loaded = [];
            loader.loadMeshCb = url => {

                loaded.push(url);

            };

            loader.parse(urdf);
            expect(loaded).toEqual([
                'path/to/package1/path/to/model.stl',
                'path/to/package2/path/to/model2.stl',
            ]);

        });

        it('should use the values from a function if set.', () => {

            const loader = new URDFLoader(testScene);
            loader.packages = pkg => {

                switch (pkg) {

                    case 'package1':
                        return 'func/path/1';
                    case 'package2':
                        return 'func/path/2';

                }

            };

            const loaded = [];
            loader.loadMeshCb = url => {

                loaded.push(url);

            };

            loader.parse(urdf);
            expect(loaded).toEqual([
                'func/path/1/path/to/model.stl',
                'func/path/2/path/to/model2.stl',
            ]);

        });

    });

});

describe('async mesh loading completion', () => {

    it('should defer loadAsync resolution until all async loadMeshCb calls have completed', async() => {

        // Simulate real async mesh loaders (STL/GLB loaders are async).
        // Before the LoadTracker fix, loadAsync resolved right after parse
        // returned — before any done() callback fired — so the resolved
        // robot had no attached meshes.
        const loader = new URDFLoader(testScene);
        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing';

        let inFlight = 0;
        let maxInFlight = 0;
        loader.loadMeshCb = (path, scene, done) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            // Force done() onto a microtask so it runs after parse returns.
            Promise.resolve().then(() => {
                inFlight--;
                const mesh = new Mesh('asyncSynth', testScene);
                done(mesh);
            });
        };

        const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/TriATHLETE.URDF');

        // All async loads should have been in flight at some point ...
        expect(maxInFlight).toBeGreaterThan(0);
        // ... and all should have resolved by the time loadAsync resolves.
        expect(inFlight).toBe(0);

        let meshCount = 0;
        robot.traverse(c => { if (c.name === 'asyncSynth') meshCount++; });
        expect(meshCount).toEqual(28);

    });

});

describe('onMeshLoaded hook', () => {

    it('should default to null', () => {

        const loader = new URDFLoader(testScene);
        expect(loader.onMeshLoaded).toBeNull();

    });

    it('should fire once per mesh produced by the default STL loader, with the original material', async() => {

        // Simulate defaultMeshLoader: create a mesh, assign an STL material,
        // fire the hook, call done. This mirrors the contract in URDFLoader.js
        // without requiring @babylonjs/loaders or network access at test time.
        const loader = new URDFLoader(testScene);
        const calls = [];
        loader.onMeshLoaded = (mesh, originalMaterial) => {
            calls.push({ meshName: mesh.name, matName: originalMaterial?.name });
        };

        loader.loadMeshCb = (path, scene, done) => {

            const mesh = new Mesh('synth', testScene);
            mesh.material = new StandardMaterial('stl-material', testScene);
            if (loader.onMeshLoaded) loader.onMeshLoaded(mesh, mesh.material);
            done(mesh);

        };

        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing';
        await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/TriATHLETE.URDF');

        expect(calls.length).toEqual(28);
        expect(calls.every(c => c.meshName === 'synth')).toBe(true);
        expect(calls.every(c => c.matName === 'stl-material')).toBe(true);

    });

    it('should allow the hook to swap mesh.material in place', () => {

        // Use an inline URDF with no <material> tag so URDF material parsing
        // doesn't overwrite the hook's assignment downstream.
        const urdf = `
            <robot name="TEST">
                <link name="LINK1">
                    <visual>
                        <origin xyz="0 0 0" rpy="0 0 0" />
                        <geometry>
                            <mesh filename="foo.stl" />
                        </geometry>
                    </visual>
                </link>
            </robot>
        `;

        const loader = new URDFLoader(testScene);
        loader.onMeshLoaded = (mesh, originalMaterial) => {
            const replacement = new StandardMaterial('custom', testScene);
            replacement.diffuseColor = new Color3(1, 0, 0);
            mesh.material = replacement;
        };

        let lastMesh = null;
        loader.loadMeshCb = (path, scene, done) => {

            const mesh = new Mesh('synth', testScene);
            mesh.material = new StandardMaterial('stl-material', testScene);
            if (loader.onMeshLoaded) loader.onMeshLoaded(mesh, mesh.material);
            lastMesh = mesh;
            done(mesh);

        };

        loader.parse(urdf);

        expect(lastMesh.material.name).toEqual('custom');
        expect(lastMesh.material.diffuseColor.r).toBeCloseTo(1);

    });

});

describe('Clone', () => {

    it('should clone the robot exactly', async() => {

        const loader = new URDFLoader(testScene);
        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/';
        loader.loadMeshCb = emptyLoadMeshCallback;
        loader.parseVisual = true;
        loader.parseCollision = true;

        const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/r2_description/robots/r2b.urdf');

        compareRobots(robot, robot.clone());

    });

    it('should clone the robot exactly even when node names have been changed', async() => {

        const loader = new URDFLoader(testScene);
        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/';
        loader.loadMeshCb = emptyLoadMeshCallback;
        loader.parseVisual = true;
        loader.parseCollision = true;

        const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/r2_description/robots/r2b.urdf');

        robot.name = 'test 1';

        compareRobots(robot, robot.clone());

    });

    it('should clone a robot with mimic joints exactly.', async() => {

        const loader = new URDFLoader(testScene);
        const robot = loader.parse(`
            <robot name="TEST">
                <link name="LINK1"/>
                <joint name="A" type="continuous">
                    <origin xyz="0 0 0" rpy="0 0 0"/>
                    <axis xyz="1 0 0"/>
                    <parent link="LINK1"/>
                    <child link="LINK2"/>
                </joint>
                <link name="LINK2"/>
                <joint name="B" type="continuous">
                    <origin xyz="0 0 0" rpy="0 0 0"/>
                    <axis xyz="1 0 0"/>
                    <parent link="LINK2"/>
                    <child link="LINK3"/>
                    <mimic joint="A" offset="-5" multiplier="23"/>
                </joint>
                <link name="LINK3"/>
            </robot>
        `);

        compareRobots(robot, robot.clone());

    });

});

describe('Load', () => {

    it(`should call complete even if all meshes can't be loaded`, async() => {

        const loader = new URDFLoader(testScene);
        const urdf = `
            <robot>
                <link
                    name="Body">
                    <visual>
                        <origin xyz="0 0 0" rpy="0 0 0" />
                        <geometry>
                            <mesh filename="../file/does/not/exist.stl" />
                        </geometry>
                    </visual>
                </link>
            </robot>
        `;

        loader.loadMeshCb = (path, scene, done) => done(null, new Error('Deliberate Test Error'));
        loader.parse(urdf);

    });

});

describe('Material Tags', () => {

    it('should parse material colors and name.', () => {

        const loader = new URDFLoader(testScene);
        const res = loader.parse(`
            <robot name="TEST">
                <material name="Cyan">
                    <color rgba="0 1.0 1.0 1.0"/>
                </material>
                <link name="LINK">
                    <visual>
                        <geometry>
                            <box size="1 1 1"/>
                        </geometry>
                        <material name="Cyan"/>
                    </visual>
                </link>
            </robot>
        `);

        // Navigate to the mesh: robot > visual > box mesh
        const visual = res.getChildren().find(c => c.isURDFVisual);
        const meshChild = visual.getChildren().find(c => c instanceof Mesh);
        const material = meshChild.material;
        expect(material.name).toEqual('Cyan');
        expect(material.diffuseColor.r).toBeCloseTo(0);
        expect(material.diffuseColor.g).toBeCloseTo(1);
        expect(material.diffuseColor.b).toBeCloseTo(1);
        expect(material.alpha).toEqual(1.0);

    });

    it('should parse transparent materials correctly.', () => {

        const loader = new URDFLoader(testScene);
        const res = loader.parse(`
            <robot name="TEST">
                <material name="Cyan">
                    <color rgba="0 1.0 1.0 0.5"/>
                </material>
                <link name="LINK">
                    <visual>
                        <geometry>
                            <box size="1 1 1"/>
                        </geometry>
                        <material name="Cyan"/>
                    </visual>
                </link>
            </robot>
        `);

        const visual = res.getChildren().find(c => c.isURDFVisual);
        const meshChild = visual.getChildren().find(c => c instanceof Mesh);
        const material = meshChild.material;
        expect(material.name).toEqual('Cyan');
        expect(material.diffuseColor.r).toBeCloseTo(0);
        expect(material.diffuseColor.g).toBeCloseTo(1);
        expect(material.diffuseColor.b).toBeCloseTo(1);
        expect(material.alpha).toEqual(0.5);
        expect(material.disableDepthWrite).toEqual(true);

    });

});

describe('TriATHLETE Climbing URDF', () => {

    let robot;
    beforeEach(async() => {

        const loader = new URDFLoader(testScene);
        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing';
        robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/urdf-loaders/master/urdf/TriATHLETE_Climbing/urdf/TriATHLETE.URDF');

    });

    it('should have the correct number of links', async() => {

        expect(Object.keys(robot.joints)).toHaveLength(27);
        expect(Object.keys(robot.links)).toHaveLength(28);

    });

    it('should load the correct joint types', async() => {

        for (const key in robot.joints) {

            const joint = robot.joints[key];
            const jointType = joint.jointType;

            if (/^W/.test(key)) expect(jointType).toEqual('continuous');
            else if (/^TC\d/.test(key)) expect(jointType).toEqual('prismatic');
            else expect(jointType).toEqual('revolute');

        }

    });

    it.todo('should respect joint limits for different joint types');

    it('should load the robonaut model successfully.', async() => {

        const loader = new URDFLoader(testScene);
        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/';
        loader.loadMeshCb = emptyLoadMeshCallback;

        const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/r2_description/robots/r2b.urdf');

        expect(Object.keys(robot.links)).toHaveLength(128);
        expect(Object.keys(robot.joints)).toHaveLength(127);

    });

    it('should load the valkyrie model successfully.', async() => {

        const loader = new URDFLoader(testScene);
        loader.packages = 'https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/';
        loader.loadMeshCb = emptyLoadMeshCallback;

        const robot = await loader.loadAsync('https://raw.githubusercontent.com/gkjohnson/nasa-urdf-robots/master/val_description/model/robots/valkyrie_A.urdf');

        expect(Object.keys(robot.links)).toHaveLength(69);
        expect(Object.keys(robot.joints)).toHaveLength(68);

    });

    it('should load the a multipackage model successfully.', async() => {

        const loader = new URDFLoader(testScene);
        loader.packages = {
            blending_end_effector:
            'https://raw.githubusercontent.com/ros-industrial-consortium/godel/kinetic-devel/godel_robots/blending_end_effector',

            abb_irb1200_support:
            'https://raw.githubusercontent.com/ros-industrial/abb_experimental/kinetic-devel/abb_irb1200_support',

            godel_irb1200_support:
            'https://raw.githubusercontent.com/ros-industrial-consortium/godel/kinetic-devel/godel_robots/abb/godel_irb1200/godel_irb1200_support',
        };
        loader.loadMeshCb = emptyLoadMeshCallback;

        const robot = await loader.loadAsync('https://raw.githubusercontent.com/ipa-jfh/urdf-loaders/2170f75bacaec933c17aeb2ee59d73643a4bab3a/multipkg_test.urdf');

        expect(Object.keys(robot.links)).toHaveLength(30);
        expect(Object.keys(robot.joints)).toHaveLength(29);

    });

});

describe('Parsing Mimic Tags', () => {

    it('should parse and link the mimicked joints.', () => {

        const loader = new URDFLoader(testScene);
        const res = loader.parse(`
            <robot name="TEST">
                <link name="LINK1"/>
                <joint name="A" type="continuous">
                    <origin xyz="0 0 0" rpy="0 0 0"/>
                    <axis xyz="1 0 0"/>
                    <parent link="LINK1"/>
                    <child link="LINK2"/>
                </joint>
                <link name="LINK2"/>
                <joint name="B" type="continuous">
                    <origin xyz="0 0 0" rpy="0 0 0"/>
                    <axis xyz="1 0 0"/>
                    <parent link="LINK2"/>
                    <child link="LINK3"/>
                    <mimic joint="A" offset="-5" multiplier="23"/>
                </joint>
                <link name="LINK3"/>
            </robot>
        `);

        const jointA = res.joints['A'];
        const jointB = res.joints['B'];

        expect(jointA.mimicJoints).toEqual([jointB]);
        expect(jointB.multiplier).toEqual(23);
        expect(jointB.offset).toEqual(-5);

    });

    it('should use defaults for multiplier and offset attributes.', () => {

        const loader = new URDFLoader(testScene);
        const res = loader.parse(`
            <robot name="TEST">
                <link name="LINK1"/>
                <joint name="A" type="continuous">
                    <origin xyz="0 0 0" rpy="0 0 0"/>
                    <axis xyz="1 0 0"/>
                    <parent link="LINK1"/>
                    <child link="LINK2"/>
                </joint>
                <link name="LINK2"/>
                <joint name="B" type="continuous">
                    <origin xyz="0 0 0" rpy="0 0 0"/>
                    <axis xyz="1 0 0"/>
                    <parent link="LINK2"/>
                    <child link="LINK3"/>
                    <mimic joint="A"/>
                </joint>
                <link name="LINK3"/>
            </robot>
        `);

        const jointB = res.joints['B'];
        expect(jointB.multiplier).toEqual(1);
        expect(jointB.offset).toEqual(0);

    });

    it('should detect infinite loops.', () => {

        const loader = new URDFLoader(testScene);
        expect(() => {
            loader.parse(`
                <robot name="TEST">
                    <link name="LINK1"/>
                    <joint name="A" type="continuous">
                        <origin xyz="0 0 0" rpy="0 0 0"/>
                        <axis xyz="1 0 0"/>
                        <parent link="LINK1"/>
                        <child link="LINK2"/>
                        <mimic joint="B" offset="-5" multiplier="23"/>
                    </joint>
                    <link name="LINK2"/>
                    <joint name="B" type="continuous">
                        <origin xyz="0 0 0" rpy="0 0 0"/>
                        <axis xyz="1 0 0"/>
                        <parent link="LINK2"/>
                        <child link="LINK3"/>
                        <mimic joint="A" offset="-5" multiplier="23"/>
                    </joint>
                    <link name="LINK3"/>
                </robot>
            `);
        }).toThrow();

    });

});
