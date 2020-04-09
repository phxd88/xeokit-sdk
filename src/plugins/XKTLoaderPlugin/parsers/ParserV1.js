/*

Parser for .XKT Format V1
-------------------------

XKT format V1 consists of entities, which have meshes, which have geometry.

The format contains the following elements.

Four geometry arrays that contain the concatenation of all geometries:

- positions     (quantized to 16-bit unsigned ints)
- normals       (oct-encoded)
- indices       (triangles)
- edgeIndices   (wireframe edges)

Three arrays of pointers into the geometry arrays, to indicate which portion of the geometry arrays belongs to
each mesh:

- meshPositions
- meshIndices
- meshEdgesIndices

An array containing the RGBA color (as four integers in range 0..255) of each mesh:

- meshColors

An array containing the string ID of each entity:

- entityIDs

An array containing a pointer into the mesh pointer arrays for each entity, to indicate the first mesh in those arrays
that belongs to the entity:

- entityMeshes

An array containing a flag for each entity, to indicate if the entity represents an object in
xeokit (eg. an IFC element):

- entityIsObjects

A 4x4 decoding matrix, for xeokit to de-quantize the integer positions back to floating-point values:

- positionsDecodeMatrix


 */

import {utils} from "../../../viewer/scene/utils.js";
import * as p from "./lib/pako.js";

let pako = window.pako || p;
if (!pako.inflate) {  // See https://github.com/nodeca/pako/issues/97
    pako = pako.default;
}

const decompressColor = (function () {
    const color2 = new Float32Array(3);
    return function (color) {
        color2[0] = color[0] / 255.0;
        color2[1] = color[1] / 255.0;
        color2[2] = color[2] / 255.0;
        return color2;
    };
})();

function extract(elements) {
    return {
        positions: elements[0],
        normals: elements[1],
        indices: elements[2],
        edgeIndices: elements[3],
        meshPositions: elements[4],
        meshIndices: elements[5],
        meshEdgesIndices: elements[6],
        meshColors: elements[7],
        entityIDs: elements[8],
        entityMeshes: elements[9],
        entityIsObjects: elements[10],
        positionsDecodeMatrix: elements[11]
    };
}

function inflate(deflatedData, pako) {
    return {
        positions: new Uint16Array(pako.inflate(deflatedData.positions).buffer),
        normals: new Int8Array(pako.inflate(deflatedData.normals).buffer),
        indices: new Uint32Array(pako.inflate(deflatedData.indices).buffer),
        edgeIndices: new Uint32Array(pako.inflate(deflatedData.edgeIndices).buffer),
        meshPositions: new Uint32Array(pako.inflate(deflatedData.meshPositions).buffer),
        meshIndices: new Uint32Array(pako.inflate(deflatedData.meshIndices).buffer),
        meshEdgesIndices: new Uint32Array(pako.inflate(deflatedData.meshEdgesIndices).buffer),
        meshColors: new Uint8Array(pako.inflate(deflatedData.meshColors).buffer),
        entityIDs: pako.inflate(deflatedData.entityIDs, {to: 'string'}),
        entityMeshes: new Uint32Array(pako.inflate(deflatedData.entityMeshes).buffer),
        entityIsObjects: new Uint8Array(pako.inflate(deflatedData.entityIsObjects).buffer),
        positionsDecodeMatrix: new Float32Array(pako.inflate(deflatedData.positionsDecodeMatrix).buffer)
    };
}

function load(viewer, options, inflatedData, performanceModel) {

    performanceModel.positionsCompression = "precompressed";
    performanceModel.normalsCompression = "precompressed";

    const positions = inflatedData.positions;
    const normals = inflatedData.normals;
    const indices = inflatedData.indices;
    const edgeIndices = inflatedData.edgeIndices;
    const meshPositions = inflatedData.meshPositions;
    const meshIndices = inflatedData.meshIndices;
    const meshEdgesIndices = inflatedData.meshEdgesIndices;
    const meshColors = inflatedData.meshColors;
    const entityIDs = JSON.parse(inflatedData.entityIDs);
    const entityMeshes = inflatedData.entityMeshes;
    const entityIsObjects = inflatedData.entityIsObjects;
    const numMeshes = meshPositions.length;
    const numEntities = entityMeshes.length;

    for (let i = 0; i < numEntities; i++) {

        const entityId = entityIDs [i];
        const metaObject = viewer.metaScene.metaObjects[entityId];
        const entityDefaults = {};
        const meshDefaults = {};

        if (metaObject) {

            if (options.excludeTypesMap && metaObject.type && options.excludeTypesMap[metaObject.type]) {
                continue;
            }

            if (options.includeTypesMap && metaObject.type && (!options.includeTypesMap[metaObject.type])) {
                continue;
            }

            const props = options.objectDefaults ? options.objectDefaults[metaObject.type || "DEFAULT"] : null;

            if (props) {
                if (props.visible === false) {
                    entityDefaults.visible = false;
                }
                if (props.pickable === false) {
                    entityDefaults.pickable = false;
                }
                if (props.colorize) {
                    meshDefaults.color = props.colorize;
                }
                if (props.opacity !== undefined && props.opacity !== null) {
                    meshDefaults.opacity = props.opacity;
                }
            }
        } else {
            if (options.excludeUnclassifiedObjects) {
                continue;
            }
        }

        const lastEntity = (i === numEntities - 1);
        const meshIds = [];

        for (let j = entityMeshes [i], jlen = lastEntity ? entityMeshes.length : entityMeshes [i + 1]; j < jlen; j++) {

            const lastMesh = (j === (numMeshes - 1));
            const meshId = entityId + ".mesh." + j;

            const color = decompressColor(meshColors.subarray((j * 4), (j * 4) + 3));
            const opacity = meshColors[(j * 4) + 3] / 255.0;

            performanceModel.createMesh(utils.apply(meshDefaults, {
                id: meshId,
                primitive: "triangles",
                positions: positions.subarray(meshPositions [j], lastMesh ? positions.length : meshPositions [j + 1]),
                normals: normals.subarray(meshPositions [j], lastMesh ? positions.length : meshPositions [j + 1]),
                indices: indices.subarray(meshIndices [j], lastMesh ? indices.length : meshIndices [j + 1]),
                edgeIndices: edgeIndices.subarray(meshEdgesIndices [j], lastMesh ? edgeIndices.length : meshEdgesIndices [j + 1]),
                positionsDecodeMatrix: inflatedData.positionsDecodeMatrix,
                color: color,
                opacity: opacity
            }));

            meshIds.push(meshId);
        }

        performanceModel.createEntity(utils.apply(entityDefaults, {
            id: entityId,
            isObject: (entityIsObjects [i] === 1),
            meshIds: meshIds
        }));
    }
}

const ParserV1 = {
    version: 1,
    parse: function (viewer, options, elements, performanceModel) {
        const deflatedData = extract(elements);
        const inflatedData = inflate(deflatedData);
        load(viewer, options, inflatedData, performanceModel);
    }
};

export {ParserV1};