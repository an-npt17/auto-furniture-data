/*

Version Updates

2024/09/07  v01     First release includes Diffuse/Roughness/Metal/Occlusion/Emission/Opacity/Normal
                    Find Missing Bitmaps, Rename GLTF Maps, Remove GLB .log file, Remove Subdivisions
                    Collapse Multi-Subs, Hide Warning Popups (Missing textures)

2024/09/10  v02     Fixes for the asset tracker when finding bitmaps (doesnt repath missing assets)
                    Flags missing assets for the user to find and repath in the listener/popup window

2024/11/02  v03     Additions (textures): Glass to transmission, sheen, clearcoat
                    Additions (values): when no bitmap use color or numerical values if changed from defaults
                    Convert VrayColor or CoronaColor nodes to color swatch
                    Convert Glossiness textures to Roughness textures (invert)
                    Convert non compliant bitmaps to jpg (example .tif)

2025/04/10  v04     Added "Export to Groups (Scene)" button:
                    Exports groups as single .glb, ungrouped objects as individual .glb
                    Generates metadata.json with position and size per exported file

2025/04/22  v05     Added quaternion rotation to metadata.json
                    Rotation converted from 3ds Max (Z-up, left-hand rule)
                    to Three.js (Y-up, right-hand rule).
                    Step 1 - flip handedness: negate x,y,z (keep w) to go LH->RH
                    Step 2 - remap axes Z-up->Y-up: (x,y,z) -> (x,z,-y)
                    Combined result: Max(x,y,z,w) -> Three.js(-x,-z,y,-w)
                    then normalize to ensure unit length

*/



macroscript CoronaVrayToGLB

category:"Vella"

tooltip:"Automate CoronaVrayToGLB"

buttonText:"Vray Corona To GLB"

Icon:"MassFX\CreateHingeConstraint"

(

    /*
    Author: James Vella
    Website: http://www.jamesvella.net/
    Name-US: CoronaVrayToGLB
    Software: 3D Studio Max 2024.2.3
    Engine: V-Ray 6.20.03, Corona 11
    Language: Maxscript
    Description-US: Convert Vray Corona PBR materials to GLTF material
    */



    ---------- Variables ----------



    scriptVersion = "5.0"

    renderEngine = ""

    testMode = false

    -- testMode = true -- Disable for live

    findTextures = false

    renameGltfMaps = true

    hideWarningPopups = false

    exportSelectedObjs = true

    removeGlbLogFile = true

    convertGlbCompliant = true

    convertGlossinessMaps = true

    convertSelectedMaterials = true

    glassToTransmission = false

    theTarget = rootnode -- switch to obj for selected objects

    missingTex = #()



    currentMaxVersion = maxVersion()

    defaultExportDirectory = @"C:\Users\" + sysInfo.username + @"\Documents\3ds Max " + (currentMaxVersion[8] as string) + @"\export\"

    if not doesFileExist defaultExportDirectory do makeDir defaultExportDirectory



    savedSettings = getDir(#userScripts) + "\\Vella\\CoronaVrayToGLB_Settings.txt"



    ---------- 3dsmax settings ----------



    animButtonState = false -- Turn off "Auto Key"



    ---------- Functions ----------



    ----------------------------------

    -- Sanitize Filename

    ----------------------------------

    fn SanitizeFilename inputName =

    (

        local source = ""

        if inputName != undefined do source = inputName as string

        if source == "" do source = "Unnamed"

        local result = ""

        local allowedChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ ()[]{}.'"

        for i = 1 to source.count do

        (

            local ch = substring source i 1

            if findString allowedChars ch != undefined then

                result += ch

            else

                result += "_"

        )

        while (result.count > 0 and (substring result result.count 1 == " " or substring result result.count 1 == "." or substring result result.count 1 == "_")) do

        (

            if result.count > 1 then

                result = substring result 1 (result.count - 1)

            else

                result = ""

        )

        while (result.count > 0 and substring result 1 1 == "_") do result = substring result 2 (result.count - 1)

        if result == "" do result = "Unnamed"

        result

    )



    -- Convert node wirecolor to a JSON-friendly hex string

    fn ColorComponentToHex component =

    (

        local hexValue = bit.intAsHex (amax 0 (amin 255 component))

        if hexValue.count == 1 do hexValue = "0" + hexValue

        hexValue

    )



    fn ColorToHex clr =

    (

        return ("#" + (ColorComponentToHex clr.r) + (ColorComponentToHex clr.g) + (ColorComponentToHex clr.b))

    )



    -- Extract material diffuse/base color from geometry nodes

    fn GetMaterialColor nodeArray =

    (

        -- Find first geometry node with a material

        for n in nodeArray where (superClassOf n == GeometryClass) and (n.material != undefined) do

        (

            local mat = n.material

            -- Multi/Sub material: use first sub-material

            if classOf mat == Multimaterial and mat.numsubs > 0 do mat = mat[1]

            -- Corona Physical Material

            if (matchPattern (classOf mat as string) pattern:"CoronaPhysicalMtl*") do return (ColorToHex mat.baseColor)

            -- Vray Material

            if (matchPattern (classOf mat as string) pattern:"VRayMtl*") do return (ColorToHex mat.Diffuse)

            -- glTF Material

            if (matchPattern (classOf mat as string) pattern:"glTFMaterial*") do return (ColorToHex mat.baseColor)

            -- Standard / Physical Material

            if classOf mat == StandardMaterial do return (ColorToHex mat.diffuse)

            if classOf mat == PhysicalMaterial do return (ColorToHex mat.base_color)

        )

        -- Fallback to wirecolor of first node

        return (ColorToHex nodeArray[1].wirecolor)

    )



    ----------------------------------

    -- Rotation: 3ds Max -> Three.js

    ----------------------------------

    -- 3ds Max quaternion properties (from SDK docs):
    --   * Left-hand rule for positive rotation direction
    --   * Z-up coordinate system (X=right, Y=forward, Z=up)
    --
    -- Three.js quaternion properties:
    --   * Right-hand rule for positive rotation direction
    --   * Y-up coordinate system (X=right, Y=up, Z=toward viewer)
    --
    -- Conversion is done in two steps:
    --
    --   Step 1 - Flip handedness LH -> RH:
    --     Negate the vector part (x,y,z), keep w.
    --     q_rh = (-x, -y, -z, w)
    --
    --   Step 2 - Remap axes Z-up -> Y-up:
    --     In Z-up:  X=right, Y=forward, Z=up
    --     In Y-up:  X=right, Y=up,      Z=toward viewer (was -Y in Z-up)
    --     So the old Z axis becomes the new Y axis,
    --     and the old Y axis becomes the new -Z axis.
    --     Apply that axis swap to the RH quaternion components:
    --     q_yup = (qx, qz, -qy, w)  where qx/qy/qz are from Step 1
    --
    --   Combined (substituting Step 1 into Step 2):
    --     Three.js(x, y, z, w) = Max(-x, -z, y, w)
    --
    --   Finally normalize to guard against any floating point drift.

    fn GetObjectRotationYUp objArray =

    (

        if classof objArray != Array then objArray = #(objArray)

        local q = quat 0 0 0 1

        -- Prefer group head rotation

        for obj in objArray where isGroupHead obj do

        (

            q = obj.rotation

            exit

        )

        -- Fallback: first geometry node

        if q == (quat 0 0 0 1) do

        (

            for obj in objArray where isValidNode obj and (superClassOf obj == GeometryClass) do

            (

                q = obj.rotation

                exit

            )

        )

        -- Step 1: flip handedness LH->RH  =>  (-x, -y, -z, w)
        -- Step 2: remap Z-up->Y-up        =>  (qx, qz, -qy, w)
        -- Combined                        =>  (-x, -z, y, w)

        local rx = -q.x

        local ry = -q.z

        local rz =  q.y

        local rw =  q.w

        -- Normalize to guard against floating point drift

        local len = sqrt (rx*rx + ry*ry + rz*rz + rw*rw)

        if len > 0.0 do

        (

            rx = rx / len

            ry = ry / len

            rz = rz / len

            rw = rw / len

        )

        return (quat rx ry rz rw)

    )



    fn BuildExportMetadataRecord objectNode exportedName sizeArray positionValue rotationValue nodeArray =

    (

        local objectName = objectNode.name

        local objectId = substituteString (SanitizeFilename objectName) " " "-"

        local objectColor = GetMaterialColor nodeArray

        local modelUrl = "/models/" + exportedName

        return #(objectId, objectName, "phong ngu", "model", sizeArray[1], sizeArray[2], sizeArray[3], "floor", objectColor, modelUrl, positionValue.x, positionValue.y, positionValue.z, rotationValue.x, rotationValue.y, rotationValue.z, rotationValue.w)

    )



    ----------------------------------

    -- Find Missing Bitmaps

    ----------------------------------



    -- Search asset tracker and repath all "Found" assets to actual path

    fn RepathFoundAssets =

    (

        -- "File Missing" in Asset Tracker

        missingATSFiles = #()

        enumerateFiles (fn getNames name a = appendIfUnique a name) missingATSFiles #missing

        for i in missingATSFiles do

        (

            appendIfUnique missingTex (getFilenameFile i + ": File Missing. Check the Asset Tracker and resolve Status to Found or OK")

        )



        -- Combine arrays removing missing files

        allFiles = for foundBitmap in (getClassInstances Bitmaptexture) collect foundBitmap.filename

        foundFiles = for f in allFiles where not (findItem missingATSFiles f > 0) collect f



        -- Repath Found or OK assets

        for i in foundFiles where (foundFiles.count > 0) do

        (

            ATSOps.SelectFiles i

            ATSOps.ResolveSelectionToAbsolute()

        )

    )



    -- Search the material for textures -> check directory for matching name

    fn FindMissingTextures currentMaterial textureType =

    (

        -- Find any bitmap in the material

        locatedBitmap = undefined

        for foundBitmap in (getClassInstances Bitmaptexture target:currentMaterial) do

        (

            -- Check if foundBitmap has a valid filename (ignore File Missing in Asset Tracker)

            if (doesFileExist foundBitmap.filename) then

            (

                -- Copy bitmap so we dont overwrite the filename

                locatedBitmap = copy foundBitmap

                exit

            )

        )



        if locatedBitmap != undefined then

        (

            wordsToRemove = #("diff", "base", "basecolor", "color", "bcolor", "albe", "alph", "opac", "metal", "rough", "ao", "occlus", "ambient", "emis", "self", "illum", "norm", "sheen")



            bitmapDir = getFilenamePath locatedBitmap.bitmap.filename

            bitmapName = getFilenameFile locatedBitmap.bitmap.filename

            bitmapExtension = getFilenameType locatedBitmap.bitmap.filename

            cleanedBitmapName = ""



            -- Search for textures and remove suffix

            regexPattern = "[-_]("  -- Match hyphen or underscore eg Sofa_Diffuse or Sofa-Diffuse

            for i = 1 to wordsToRemove.count do

            (

                regexPattern += wordsToRemove[i] + ".*"

                if i < wordsToRemove.count do regexPattern += "|"

            )

            regexPattern += ")$"

            regexReplace = dotNetObject "System.Text.RegularExpressions.Regex" regexPattern (dotNetClass "System.Text.RegularExpressions.RegexOptions").IgnoreCase

            cleanedBitmapName = regexReplace.Replace bitmapName ""



            -- Collect Locate all textures in directory

            allBitmapsInDirectory = #()

            for f in getFiles (bitmapDir + "*.*") do

            (

                append allBitmapsInDirectory (getFilenameFile f)

            )



            -- Now find a matching bitmap for the node type (diffuse, roughness etc)

            wordsToFind = #()

            case textureType of

            (

                "Diffuse": wordsToFind = #("diff", "base", "basecolor", "color", "bcolor", "albe")

                "Alpha": wordsToFind = #("alph", "opac")

                "Metal": wordsToFind = #("metal")

                "Roughness": wordsToFind = #("rough")

                "Occlusion": wordsToFind = #("ao", "occlus", "ambient")

                "Emission": wordsToFind = #("emis", "self", "illum")

                "Normal": wordsToFind = #("norm")

                "Sheen": wordsToFind = #("sheen")

                "SheenRoughness": wordsToFind = #("sheen_r", "sheen r", "sheen-r", "sheenr")

                "ClearCoat": wordsToFind = #("clear", "coat", "clearcoat")

                "ClearCoatRoughness": wordsToFind = #("clear-r","clear_r", "clear r", "coat-r", "coat_r", "coat r", "clearcoat-r", "clearcoat_r", "clearcoat r", "clear_coat-r", "clear_coat_r", "clear_coat r")

                "ClearCoatNormal": wordsToFind = #("clear-n","clear_n", "clear n", "coat-n", "coat_n", "coat n", "clearcoat-n","clearcoat_n","clearcoat n")

            )



            -- Replace suffix

            for bitmapName in allBitmapsInDirectory do

            (

                for word in wordsToFind do

                (

                    regexPattern = cleanedBitmapName + "[-_](" + word + ".*)$"  -- Match hyphen or underscore eg Sofa_Diffuse or Sofa-Diffuse

                    regexSearch = dotNetObject "System.Text.RegularExpressions.Regex" regexPattern (dotNetClass "System.Text.RegularExpressions.RegexOptions").IgnoreCase



                    if regexSearch.IsMatch(bitmapName) then

                    (

                        locatedBitmap.filename = (bitmapDir + bitmapName + bitmapExtension)

                        return locatedBitmap

                    )

                )

            )

        )

        return undefined

    )



    -- Search for bitmaps if findTexture == True

    fn SearchBitmapNodes currentMaterial bitmapNode textureType =

    (

        locatedBitmap = undefined



        -- Look for bitmap in this node tree

        if bitmapNode != undefined then

        (

            for foundBitmap in (getClassInstances Bitmaptexture target:bitmapNode) do

            (

                locatedBitmap = foundBitmap

                return foundBitmap

            )

        )



        -- No bitmap found -> search directory for texture

        if (locatedBitmap == undefined) or (classof locatedBitmap != Bitmaptexture) then

        (

            locatedBitmap = FindMissingTextures currentMaterial textureType

            if locatedBitmap != undefined then

            (

                return locatedBitmap

            )

            else

            (

                if  (bitmapNode != alphaNode) or

                    (bitmapNode != emissionNode) or

                    (bitmapNode != sheenNode) or

                    (bitmapNode != sheenRoughNode) or

                    (bitmapNode != clearCoatNode) or

                    (bitmapNode != clearCoatRoughNode) or

                    (bitmapNode != clearCoatNormalNode) then

                (

                    -- Did not find bitmap in the texture directory that matches (eg. texture dir search)

                    appendIfUnique missingTex (currentMaterial.name + " - Missing: " + textureType + " Texture")

                )

            )

        )

        return undefined

    )



    ----------------------------------

    -- Convert Colors and Values

    ----------------------------------



    -- Invert 0.0 to 1.0 or inverse

    fn InvertValue val =

    (

        return 1.0 - val

    )



    -- Remap color values 255 to 0-1 range

    fn MapToUnitRange val =

    (

        return val / 255.0

    )



    -- Remap HDR Colors from range 0-1 to 0-255

    fn RemapHDRtoRGB colorHdr cSpace =

    (

        colorRed = if colorHdr[1] > 1.0 then 1.0 else colorHdr[1]

        colorGreen = if colorHdr[2] > 1.0 then 1.0 else colorHdr[2]

        colorBlue = if colorHdr[3] > 1.0 then 1.0 else colorHdr[3]



        -- sRGB Color Space

        if cSpace == 0 then

        (

            colorRed = pow colorRed 2.2 * 255.0

            colorGreen = pow colorGreen 2.2 * 255.0

            colorBlue = pow colorBlue 2.2 * 255.0

        )



        -- Linear Color Space

        if cSpace == 1 or cSpace == 2 then

        (

            colorRed = colorRed * 255.0

            colorGreen = colorGreen * 255.0

            colorBlue = colorBlue * 255.0



            -- FIXME: Rendering Color Space (cSpace: 2)

        )



        return (color colorRed colorGreen colorBlue)

    )



    -- Convert Temperature to RGB

    fn KelvinToRGB tempKelvin =

    (

        temperature = tempKelvin / 100.0



        if temperature <= 66.0 then

        (

            colorRed = 255

            colorGreen = (99.4708025861 * log temperature) - 161.1195681661

            colorBlue = if temperature <= 19.0 then 0 else ((138.5177312231 * log (temperature - 10)) - 305.0447927307)

        )

        else

        (

            colorRed = (329.698727446 * ((temperature - 60) ^ -0.1332047592))

            colorGreen = (288.1221695283 * ((temperature - 60) ^ -0.0755148492))

            colorBlue = 255

        )



        colorRed = amax (amin colorRed 255) 0

        colorGreen = amax (amin colorGreen 255) 0

        colorBlue = amax (amin colorBlue 255) 0



        return (color colorRed colorGreen colorBlue)

    )



    -- Convert HEX to RGB

    fn HexToRGB hexColor =

    (

        -- Remove the "#"

        hexColor = substituteString hexColor "#" ""



        -- Convert HEX components to decimal

        colorRed = (execute ("0x" + (substring hexColor 1 2))) as float / 255.0

        colorGreen = (execute ("0x" + (substring hexColor 3 2))) as float / 255.0

        colorBlue = (execute ("0x" + (substring hexColor 5 2))) as float / 255.0



        -- Apply gamma correction for sRGB

        colorRed = pow colorRed 2.2 * 255.0

        colorGreen = pow colorGreen 2.2 * 255.0

        colorBlue = pow colorBlue 2.2 * 255.0



        return (color colorRed colorGreen colorBlue)

    )



    -- Gamma 1.0 to 2.2 or inverse

    fn ApplyGammaToColors colorValue gammaValue =

    (

        local colorRed = 255.0 * ( (colorValue.r / 255.0) ^ gammaValue )

        local colorGreen = 255.0 * ( (colorValue.g / 255.0) ^ gammaValue )

        local colorBlue = 255.0 * ( (colorValue.b / 255.0) ^ gammaValue )



        return (color colorRed colorGreen colorBlue)

    )



    -- Convert Color Nodes if no Bitmap

    fn ConvertColorNodes bitmapNode =

    (

        if bitmapNode != undefined then

        (

            if renderEngine == "Vray" then

            (

                for foundNode in (getClassInstances VRayColor target:bitmapNode) do

                (

                    if foundNode.color_gamma == 1.0 then

                    (

                        return foundNode.color

                    )

                    else

                    (

                        return ApplyGammaToColors foundNode.color foundNode.color_gamma

                    )

                )

            )



            if renderEngine == "Corona" then

            (

                for foundNode in (getClassInstances CoronaColor target:bitmapNode) do

                (

                    -- Input: Solid Color

                    if foundNode.method == 0 then return foundNode.color



                    -- Input: Solid HDR Color

                    if foundNode.method == 1 then return RemapHDRtoRGB foundNode.colorHdr foundNode.colorSpace



                    -- Input: Kelvin Temperature

                    if foundNode.method == 2 then return KelvinToRGB foundNode.temperature



                    -- Input: Hex Color

                    if foundNode.method == 3 then return HexToRGB foundNode.hexColor

                )

            )

        )

        return undefined

    )



    ----------------------------------

    -- Convert Materials

    ----------------------------------



    -- Convert files to jpg if not jpg/png

    fn ConvertBitmapToJpg currentBitmap =

    (

        bitmapFileName = currentBitmap.filename

        bitmapFileTypes = #(".jpg", ".jpeg", ".png")

        fileExtension = getFilenameType bitmapFileName

        if findItem bitmapFileTypes fileExtension == 0 do

        (

            try(originalBitmap = openBitmap bitmapFileName)catch()

            if (originalBitmap != undefined and isKindOf originalBitmap bitmap) then

            (

                newBitmapFilename = (getFilenamePath bitmapFileName + getFilenameFile bitmapFileName + ".jpg")

                if doesFileExist newBitmapFilename then

                (

                    currentBitmap.filename = newBitmapFilename

                )

                else

                (

                    print ("Converting Non-Compliant GLB Texture:" + (filenameFromPath bitmapFileName))

                    newBitmap = bitmap originalBitmap.width originalBitmap.height

                    pasteBitmap originalBitmap newBitmap [0,0] [0,0]

                    newBitmap.filename = newBitmapFilename

                    save newBitmap

                    close newBitmap

                    close originalBitmap



                    currentBitmap.filename = newBitmap.filename

                    free newBitmap -- garbage collect

                    free originalBitmap

                )

            )

        )

    )



    -- Invert Bitmap white -> black or visa versa

    fn InvertGlossinessTextures glossMap =

    (

        invertedFileName = (getFilenamePath glossMap + getFilenameFile glossMap + "_inverted" + getFilenameType glossMap)

        if doesFileExist invertedFileName then

        (

            return invertedFileName

        )

        else

        (

            print ("Converting Glossiness Texture: " + (filenameFromPath glossMap))

            try(originalBitmap = openBitmap glossMap)catch()

            if (originalBitmap != undefined and isKindOf originalBitmap bitmap) then

            (

                invertedBitmap = copy originalBitmap

                for y = 0 to (invertedBitmap.height - 1) do

                (

                    pixels = getPixels invertedBitmap [0, y] invertedBitmap.width

                    for i = 1 to pixels.count do

                    (

                        pixels[i] = color (255 - pixels[i].r) (255 - pixels[i].g) (255 - pixels[i].b)

                    )

                    setPixels invertedBitmap [0, y] pixels

                )



                invertedFileName = (getFilenamePath glossMap + getFilenameFile glossMap + "_inverted" + getFilenameType glossMap)

                invertedBitmap.filename = invertedFileName

                save invertedBitmap

                close invertedBitmap

                close originalBitmap

                free invertedBitmap

                free originalBitmap



                return invertedFileName

            )

        )

        return undefined

    )



    -- Replaces the found bitmap from Corona/Vray to GLTF node (eg. BaseColor or Rough)

    fn ReplaceGLTFBitmap materialName materialMap bitmapNode bitmapType gammaValue gltfCompliant =

    (

        if bitmapNode != undefined then

        (

            -- Look for bitmap in this node tree

            for foundBitmap in (getClassInstances Bitmaptexture target:bitmapNode) do

            (

                materialMap = foundBitmap

                if doesFileExist materialMap.filename then

                (

                    materialMap.bitmap = openBitmap materialMap.filename gamma:gammaValue

                )

                if materialMap != undefined then return materialMap

            )

        )



        if (materialMap == undefined) and (gltfCompliant == "Required") then

        (

            appendIfUnique missingTex (materialName + " - Missing: " + bitmapType + " Texture")

            return undefined

        )

    )



    -- Convert Corona or VrayMtl to glTF material

    fn ConvertToGltf currentMaterial =

    (

        -- Re-path bitmaps to "Found" location, must be after converting Engine specific to standard bitmaps

        RepathFoundAssets()



        -- Basic settings for GLTF shader

        newMaterial = undefined

        (

            if isKindOf (gltfMat = execute "glTFMaterial") Material do

            (

                newMaterial = gltfMat()

            )

        )



        if newMaterial != undefined then

        (

            newMaterial.name = currentMaterial.name

        )

        else

        (

            messageBox ("Your 3dsmax version does not support GLTF.\n3dsmax 2023+ Required.")

            return undefined

        )



        if renderEngine == "Corona" then

        (

            diffuseNode = currentMaterial.baseTexmap

            diffuseColor = currentMaterial.baseColor

            roughNode = currentMaterial.baseRoughnessTexmap

            roughValue = currentMaterial.baseRoughness

            roughBrdf = currentMaterial.roughnessMode

            if roughBrdf == 0 then roughBrdf = true else roughBrdf = false

            bumpNode = currentMaterial.baseBumpTexmap

            try(normalNode = currentMaterial.baseBumpTexmap.normalMap)catch()

            metalNode = currentMaterial.metalnessTexmap

            metalValue = currentMaterial.metalnessMode -- == 1

            alphaNode = currentMaterial.opacityTexmap

            emissionNode = currentMaterial.selfIllumTexmap

            emissionValue = currentMaterial.selfIllumLevel

            emissionColor = currentMaterial.selfIllumColor

            sheenNode = currentMaterial.sheenColorTexmap

            sheenValue = currentMaterial.sheenAmount

            sheenColor = currentMaterial.sheenColor

            sheenRoughNode = currentMaterial.sheenRoughnessTexmap

            sheenRoughValue = currentMaterial.sheenRoughness

            clearCoatNode = currentMaterial.clearcoatAmountTexmap

            clearCoatValue = currentMaterial.clearcoatAmount

            clearCoatRoughNode = currentMaterial.clearcoatRoughnessTexmap

            clearCoatRoughValue = currentMaterial.clearcoatRoughness

            clearCoatBumpNode = currentMaterial.clearcoatBumpTexmap

            try(clearCoatNormalNode = currentMaterial.clearcoatBumpTexmap.normalMap)catch()

            clearCoatNormalValue = currentMaterial.clearcoatBumpMapAmount

            transmissionNode = currentMaterial.refractionAmountTexmap

            transmissionValue = currentMaterial.refractionAmount

            transmissionRoughValue = currentMaterial.baseRoughness

        )



        if renderEngine == "Vray" then

        (

            diffuseNode = currentMaterial.texmap_diffuse

            diffuseColor = currentMaterial.Diffuse

            roughNode = currentMaterial.texmap_reflectionGlossiness

            roughValue = currentMaterial.reflection_glossiness

            roughBrdf = currentMaterial.brdf_useRoughness

            bumpNode = currentMaterial.texmap_bump

            try(normalNode = currentMaterial.texmap_bump.normal_map)catch()

            metalNode = currentMaterial.texmap_metalness

            metalValue = currentMaterial.reflection_metalness

            alphaNode = currentMaterial.texmap_opacity

            emissionNode = currentMaterial.texmap_self_illumination

            emissionValue = currentMaterial.selfIllumination_multiplier

            emissionColor = currentMaterial.selfIllumination

            sheenNode = currentMaterial.texmap_sheen

            sheenColor = currentMaterial.sheen_color

            sheenRoughNode = currentMaterial.texmap_sheen_glossiness

            sheenRoughValue = currentMaterial.sheen_glossiness

            clearCoatNode = currentMaterial.texmap_coat_amount

            clearCoatValue = currentMaterial.coat_amount

            clearCoatRoughNode = currentMaterial.texmap_coat_glossiness

            clearCoatRoughValue = currentMaterial.coat_glossiness

            clearCoatBumpNode = currentMaterial.texmap_coat_bump

            try(clearCoatNormalNode = currentMaterial.texmap_coat_bump.normal_map)catch()

            clearCoatNormalValue = currentMaterial.texmap_coat_bump_multiplier

            transmissionNode = currentMaterial.texmap_refraction

            transmissionValue = MapToUnitRange currentMaterial.Refraction.value

            transmissionRoughValue = currentMaterial.refraction_glossiness

            transmissionVolumeThickMap = currentMaterial.texmap_refraction_fog_depth

            reflectionValue = currentMaterial.Reflection.value

        )



        -- Search directory for textures

        if findTextures == true then

        (

            foundDiffuse = SearchBitmapNodes currentMaterial diffuseNode "Diffuse"

            if foundDiffuse != undefined then diffuseNode = foundDiffuse



            foundRough = SearchBitmapNodes currentMaterial roughNode "Roughness"

            if foundRough != undefined then roughNode = foundRough



            foundMetal = SearchBitmapNodes currentMaterial metalNode "Metal"

            if foundMetal != undefined then metalNode = foundMetal



            foundEmission = SearchBitmapNodes currentMaterial emissionNode "Emission"

            if foundEmission != undefined then emissionNode = foundEmission



            foundOcclusion = SearchBitmapNodes currentMaterial occlusionNode "Occlusion"

            if foundOcclusion != undefined then occlusionNode = foundOcclusion



            foundNormal = SearchBitmapNodes currentMaterial normalNode "Normal"

            if foundNormal != undefined then normalNode = foundNormal



            foundAlpha = SearchBitmapNodes currentMaterial alphaNode "Alpha"

            if foundAlpha != undefined then alphaNode = foundAlpha



            foundSheen = SearchBitmapNodes currentMaterial sheenNode "Sheen"

            if foundSheen != undefined then sheenNode = foundSheen



            foundSheenRough = SearchBitmapNodes currentMaterial sheenRoughNode "SheenRoughness"

            if foundSheenRough != undefined then sheenRoughNode = foundSheenRough



            foundClearCoatNode = SearchBitmapNodes currentMaterial clearCoatNode "ClearCoat"

            if foundClearCoatNode != undefined then clearCoatNode = foundClearCoatNode



            foundClearCoatRoughNode = SearchBitmapNodes currentMaterial clearCoatRoughNode "ClearCoatRoughness"

            if foundClearCoatRoughNode != undefined then clearCoatRoughNode = foundClearCoatRoughNode



            foundClearCoatNormal = SearchBitmapNodes currentMaterial clearCoatNormalNode "ClearCoatNormal"

            if foundClearCoatNormal != undefined then clearCoatNormalNode = foundClearCoatNormal

        )



        -- BRDF

        if renderEngine == "Vray" and roughBrdf == false then

        (

            roughValue = InvertValue roughValue

            sheenRoughValue = InvertValue sheenRoughValue

            clearCoatRoughValue = InvertValue clearCoatRoughValue

        )



        -- Diffuse

        gltfDiffuse = ReplaceGLTFBitmap newMaterial.name newMaterial.baseColorMap diffuseNode "Diffuse" 2.2 "Required"

        if gltfDiffuse != undefined then newMaterial.baseColorMap = gltfDiffuse



        if gltfDiffuse == undefined and isKindOf diffuseColor color then

        (

            foundColorNode = ConvertColorNodes diffuseNode

            if foundColorNode != undefined then

            (

                newMaterial.baseColor = foundColorNode

            )

            else

            (

                newMaterial.baseColor = diffuseColor

            )

        )



        -- Roughness

        gltfRough = ReplaceGLTFBitmap newMaterial.name newMaterial.roughnessMap roughNode "Roughness" 1.0 "Required"

        if gltfRough != undefined then newMaterial.roughnessMap = gltfRough



        if gltfRough == undefined and roughValue != undefined then

        (

            newMaterial.roughness = roughValue

        )



        -- Glossiness Texture Conversion

        if convertGlossinessMaps == true and roughBrdf == false and gltfRough != undefined then

        (

            invertedBitmapPath = InvertGlossinessTextures gltfRough.filename

            if invertedBitmapPath != undefined then

            (

                newMaterial.roughnessMap.filename = invertedBitmapPath

            )

        )



        -- Metalness

        gltfMetal = ReplaceGLTFBitmap newMaterial.name newMaterial.metalnessMap metalNode "Metalness" 1.0 "Required"

        if gltfMetal != undefined then newMaterial.metalnessMap = gltfMetal



        if gltfMetal == undefined then

        (

            if renderEngine == "Vray" and metalValue > 0 then

            (

                newMaterial.metalness = metalValue

            )

            if renderEngine == "Corona" and metalValue == 1 then

            (

                newMaterial.metalness = 1.0

            )

        )



        -- Normal

        gltfNormal = ReplaceGLTFBitmap newMaterial.name newMaterial.normalMap normalNode "Normal" 1.0 "Required"

        if gltfNormal != undefined then newMaterial.normalMap = gltfNormal



        if newMaterial.normalMap == undefined then

        (

            gltfNormal = ReplaceGLTFBitmap newMaterial.name newMaterial.normalMap bumpNode "Bump" 1.0 "Optional"

            if gltfNormal != undefined then newMaterial.normalMap = gltfNormal

        )



        -- Occlusion

        gltfOcclusion = ReplaceGLTFBitmap newMaterial.name newMaterial.ambientOcclusionMap occlusionNode "Occlusion" 1.0 "Required"

        if gltfOcclusion != undefined then newMaterial.ambientOcclusionMap = gltfOcclusion



        -- Optional Textures --



        -- Emission

        gltfEmission = ReplaceGLTFBitmap newMaterial.name newMaterial.emissionMap emissionNode "Emission" 2.2 "Optional"

        if gltfEmission != undefined then newMaterial.emissionMap = gltfEmission



        if gltfEmission == undefined then

        (

            foundColorNode = ConvertColorNodes emissionNode

            if foundColorNode != undefined then

            (

                newMaterial.emissionColor = foundColorNode

            )

            else

            (

                if renderEngine == "Vray" and emissionColor != (color 0 0 0) then

                (

                    newMaterial.emissionColor = emissionColor

                )

                if renderEngine == "Corona" and emissionValue > 0 then

                (

                    newMaterial.emissionColor = emissionColor

                )

            )

        )



        -- Alpha

        gltfAlpha = ReplaceGLTFBitmap newMaterial.name newMaterial.AlphaMap alphaNode "Alpha" 1.0 "Optional"

        if gltfAlpha != undefined then newMaterial.AlphaMap = gltfAlpha



        if newMaterial.AlphaMap != undefined then

        (

            newMaterial.alphaMode = 2    -- Mask mode

            newMaterial.alphaCutoff = 0.5

        )



        -- Sheen

        gltfSheen = ReplaceGLTFBitmap newMaterial.name newMaterial.sheenColorMap sheenNode "Sheen" 2.2 "Optional"

        if gltfSheen != undefined then

        (

            newMaterial.enableSheen = on

            newMaterial.sheenColorMap = gltfSheen

        )



        -- Sheen Roughness

        gltfSheenRough = ReplaceGLTFBitmap newMaterial.name newMaterial.sheenRoughnessMap sheenRoughNode "SheenRoughness" 1.0 "Optional"

        if gltfSheenRough != undefined then

        (

            newMaterial.enableSheen = on

            newMaterial.sheenRoughnessMap = gltfSheenRough

        )



        if renderEngine == "Vray" and sheenColor != (color 0 0 0) then

        (

            newMaterial.enableSheen = on

            newMaterial.sheenColor = sheenColor



            if gltfSheenRough == undefined then

            (

                newMaterial.sheenRoughness = sheenRoughValue

            )

        )

        if renderEngine == "Corona" and sheenValue > 0 then

        (

            if gltfSheen == undefined then

            (

                newMaterial.enableSheen = on

                newMaterial.sheenColor = sheenColor



                if gltfSheenRough == undefined then

                (

                    newMaterial.sheenRoughness = sheenRoughValue

                )

            )

        )



        -- Sheen Color (Node)

        if gltfSheen == undefined then

        (

            foundColorNode = ConvertColorNodes sheenNode

            if foundColorNode != undefined then

            (

                newMaterial.enableSheen = on

                newMaterial.sheenColor = foundColorNode

            )

        )



        -- Clear Coat

        gltfClearCoat = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatMap clearCoatNode "ClearCoat" 2.2 "Optional"

        if gltfClearCoat != undefined then

        (

            newMaterial.enableClearCoat = on

            newMaterial.clearcoatMap = gltfClearCoat

        )



        if gltfClearCoat == undefined and clearCoatValue > 0 then

        (

            newMaterial.enableClearCoat = on

            newMaterial.clearcoat = clearCoatValue

        )



        -- Clear Coat Roughness

        gltfClearCoatRough = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatRoughnessMap clearCoatRoughNode "ClearCoatRoughness" 1.0 "Optional"

        if gltfClearCoatRough != undefined then

        (

            newMaterial.enableClearCoat = on

            newMaterial.clearcoatRoughnessMap = gltfClearCoatRough

        )



        if gltfClearCoatRough == undefined and clearCoatValue > 0 then

        (

            newMaterial.enableClearCoat = on

            newMaterial.clearcoatRoughness = clearCoatRoughValue

        )



        -- Clear Coat Normal

        gltfClearCoatNormal = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatNormalMap clearCoatNormalNode "ClearCoatNormal" 1.0 "Optional"

        if gltfClearCoatNormal != undefined then

        (

            newMaterial.enableClearCoat = on

            newMaterial.clearcoatNormalMap = gltfClearCoatNormal

        )



        if newMaterial.clearcoatNormalMap == undefined then

        (

            gltfClearCoatNormal = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatNormalMap clearCoatBumpNode "ClearCoatNormal" 1.0 "Optional"

            if gltfClearCoatNormal != undefined then newMaterial.clearcoatNormalMap = gltfClearCoatNormal

        )



        if newMaterial.enableClearCoat == on and newMaterial.clearcoatNormalMap != undefined then

        (

            if renderEngine == "Vray" and clearCoatNormalValue != 30.0 then

            (

                newMaterial.clearcoatNormal = clearCoatNormalValue / 100.0

            )

            if renderEngine == "Corona" and clearCoatNormalValue != 1.0 then

            (

                newMaterial.clearcoatNormal = clearCoatNormalValue

            )

        )



        -- Transmission

        if glassToTransmission == true then

        (

            if transmissionValue > 0 or (renderEngine == "Corona" and currentMaterial.useThinMode == true) then

            (

                newMaterial.enableTransmission = on

                newMaterial.transmission = transmissionValue



                gltfTransmission = ReplaceGLTFBitmap newMaterial.name newMaterial.transmissionMap transmissionNode "Transmission" 1.0 "Optional"

                if gltfTransmission != undefined then

                (

                    newMaterial.enableTransmission = on

                    newMaterial.transmissionMap = gltfTransmission

                )



                if newMaterial.roughnessMap == undefined then

                (

                    if renderEngine == "Vray" then

                    (

                        if transmissionRoughValue != 1 then

                        (

                            if roughBrdf == false then transmissionRoughValue = InvertValue transmissionRoughValue

                            newMaterial.roughness = transmissionRoughValue

                        )

                        if transmissionRoughValue == 1 and roughValue != 1 then

                        (

                            newMaterial.roughness = roughValue

                        )

                    )

                    if renderEngine == "Corona" and transmissionRoughValue != 0 then

                    (

                        newMaterial.roughness = transmissionRoughValue

                    )

                )



                -- Transmission Volume

                if renderEngine == "Vray" then

                (

                    if currentMaterial.refraction_fogDepth > 0 then

                    (

                        newMaterial.enableVolume = on

                        newMaterial.volumeThickness = 1

                        newMaterial.volumeDistance = 1

                        newMaterial.volumeColor = currentMaterial.refraction_fogColor



                        gltfVolumeThickMap = ReplaceGLTFBitmap newMaterial.name newMaterial.volumeThicknessMap transmissionVolumeThickMap "transmissionVolumeThickMap" 1.0 "Optional"

                        if gltfVolumeThickMap != undefined then newMaterial.volumeThicknessMap = gltfVolumeThickMap



                        if currentMaterial.texmap_refraction_fog != undefined then

                        (

                            foundColorNode = ConvertColorNodes currentMaterial.texmap_refraction_fog

                            if foundColorNode != undefined then

                            (

                                newMaterial.volumeColor = foundColorNode

                            )

                        )

                    )

                )



                if renderEngine == "Corona" then

                (

                    if currentMaterial.attenuationDistance > 0 and currentMaterial.useThinMode == false then

                    (

                        newMaterial.enableVolume = on

                        newMaterial.volumeThickness = 1

                        newMaterial.volumeDistance = 1

                        newMaterial.volumeColor = currentMaterial.volumetricScatteringColor



                        if currentMaterial.volumetricScatteringTexmap != undefined then

                        (

                            foundColorNode = ConvertColorNodes currentMaterial.volumetricScatteringTexmap

                            if foundColorNode != undefined then

                            (

                                newMaterial.volumeColor = foundColorNode

                            )

                        )

                    )



                    if currentMaterial.useThinMode == on and currentMaterial.translucencyFraction > 0 then

                    (

                        newMaterial.enableVolume = on

                        newMaterial.volumeThickness = 1

                        newMaterial.volumeDistance = 1

                        newMaterial.volumeColor = currentMaterial.translucencyColor

                        newMaterial.transmission = currentMaterial.translucencyFraction



                        if currentMaterial.translucencyColorTexmap != undefined then

                        (

                            foundColorNode = ConvertColorNodes currentMaterial.translucencyColorTexmap

                            if foundColorNode != undefined then

                            (

                                newMaterial.volumeColor = foundColorNode

                            )

                        )

                    )



                    if currentMaterial.useThinMode == on and (currentMaterial.refractionAmount == 1 or transmissionNode != undefined) then

                    (

                        newMaterial.enableVolume = on

                        newMaterial.volumeThickness = 1

                        newMaterial.volumeDistance = 1

                        newMaterial.volumeColor = currentMaterial.thinAbsorptionColor

                        newMaterial.transmission = 1



                        if currentMaterial.thinAbsorptionTexmap != undefined then

                        (

                            foundColorNode = ConvertColorNodes currentMaterial.thinAbsorptionTexmap

                            if foundColorNode != undefined then

                            (

                                newMaterial.volumeColor = foundColorNode

                            )

                        )

                    )

                )



                -- Glass Assumptions

                if renderEngine == "Vray" then

                (

                    if gltfDiffuse == undefined and diffuseColor.value < 45.0 and reflectionValue > 125.0 and transmissionValue > 0.8 then

                    (

                        newMaterial.baseColor = (color 255 255 255)

                    )

                )

                if renderEngine == "Corona" then

                (

                    if gltfDiffuse == undefined and diffuseColor.value < 128.0 and transmissionValue > 0.8 then

                    (

                        newMaterial.baseColor = (color 255 255 255)

                    )

                )

            )

        )



        -- Rename GLTF Maps

        if renameGltfMaps == true then

        (

            try(newMaterial.baseColorMap.name = "Base Color")catch()

            try(newMaterial.roughnessMap.name = "Roughness")catch()

            try(newMaterial.metalnessMap.name = "Metalness")catch()

            try(newMaterial.AlphaMap.name = "Alpha")catch()

            try(newMaterial.emissionMap.name = "Emission")catch()

            try(newMaterial.ambientOcclusionMap.name = "Occlusion")catch()

            try(newMaterial.normalMap.name = "Normal")catch()

            try(newMaterial.sheenColorMap.name = "Sheen")catch()

            try(newMaterial.sheenRoughnessMap.name = "SheenRoughness")catch()

            try(newMaterial.clearcoatMap.name = "ClearCoat")catch()

            try(newMaterial.clearcoatRoughnessMap.name = "ClearCoatRoughness")catch()

            try(newMaterial.clearcoatNormalMap.name = "ClearCoatNormal")catch()

            try(newMaterial.transmissionMap.name = "Transmission")catch()

            try(newMaterial.volumeThicknessMap.name = "VolumeThickness")catch()

        )



        -- Convert bitmaps to GLB compliant (example: tif -> jpg)

        if convertGlbCompliant == true then

        (

            for i in getClassInstances bitmaptexture target:newMaterial do

            (

                if i != undefined then ConvertBitmapToJpg i

            )

        )



        return newMaterial

    )



    ----------------------------------

    -- Vray Section

    ----------------------------------



    fn ConvertVrayBitamps =

    (

        for i in getClassInstances VRayBitmap target:theTarget do

        (

            if (i.HDRIMapName != undefined) then

            (

                newBitmap = Bitmaptexture()

                newBitmap.filename = i.HDRIMapName

                newBitmap.name = i.name

                replaceinstances i newBitmap

            )

        )

    )



    fn ConvertVrayMtls =

    (

        for i in getClassInstances VRayMtl target:theTarget do

        (

            p = (ConvertToGltf i)

            if p != undefined then replaceInstances i p

        )

    )



    fn ConvertVrayClasses =

    (

        for i in material.classes do

        (

            if matchPattern (i as string) pattern:"*Vray*" then

            (

                for j in getClassInstances i do

                (

                    if isKindOf (gltfMat = execute "glTFMaterial") Material do

                    (

                        for k in getClassInstances gltfMat target:j do

                        (

                            replaceInstances j k

                        )

                    )

                )

            )

        )

    )



    ----------------------------------

    -- Corona Section

    ----------------------------------



    fn ConvertCoronaBitmaps =

    (

        for i in getClassInstances CoronaBitmap target:theTarget do

        (

            if i != undefined then

            (

                newBitmap = Bitmaptexture()

                newBitmap.filename = i.filename

                newBitmap.name = i.name

                replaceinstances i newBitmap

            )

        )

    )



    fn ConvertCoronaFrontSide =

    (

        for i in getClassInstances CoronaFrontBack target:theTarget do

        (

            for j in getClassInstances Bitmaptexture target:i do

            (

                replaceinstances i j

            )

        )

    )



    fn ConvertCoronaMtls =

    (

        for i in getClassInstances CoronaPhysicalMtl target:theTarget do

        (

            p = (ConvertToGltf i)

            if p != undefined then replaceInstances i p

        )

    )



    fn ConvertCoronaClasses =

    (

        for i in material.classes do

        (

            if matchPattern (i as string) pattern:"*Corona*" then

            (

                for j in getClassInstances i do

                (

                    if isKindOf (gltfMat = execute "glTFMaterial") Material do

                    (

                        for k in getClassInstances gltfMat target:j do

                        (

                            replaceInstances j k

                        )

                    )

                )

            )

        )

    )



    ----------------------------------

    -- Convert Materials (button)

    ----------------------------------



    fn ConvertCoronaVray =

    (

        if matchPattern (renderers.current as string) pattern:"*V_RAY*" then

        (

            renderEngine = "Vray"

            ConvertVrayBitamps()

            ConvertVrayMtls()

            ConvertVrayClasses()

        )



        if matchPattern (renderers.current as string) pattern:"*Corona*" then

        (

            renderEngine = "Corona"

            ConvertCoronaBitmaps()

            ConvertCoronaFrontSide()

            ConvertCoronaMtls()

            ConvertCoronaClasses()

        )

        ForceCompleteRedraw()

    )



    fn PrintMissingTextures =

    (

        if missingTex.count != 0 then

        (

            for i in missingTex do

            (

                print i

            )



            if hideWarningPopups == false then

            (

                messageBox ("Some of your materials are missing textures. Check the MAXScript Listener for details.")

            )

        )

        free missingTex

        ATSOps.Refresh()

    )



    ----------------------------------

    -- Remove Subdivision Modifiers

    ----------------------------------



    fn RemoveSubdivions =

    (

        for obj in objects do

        (

            for mod in obj.modifiers do

            (

                if (mod.name == "OpenSubdiv" or mod.name == "TurboSmooth" or mod.name == "MeshSmooth") do

                (

                    deleteModifier obj mod

                )

            )

        )

    )



    ----------------------------------

    -- Collapse Multi-Sub Materials

    ----------------------------------



    fn CountBitmapsFromMaterial mat =

    (

        foundMapCount = 0

        for x in getClassInstances bitmaptexture do

        (

            for y in refs.dependents x where y == mat do

            (

                foundMapCount += 1

            )

        )

        return foundMapCount

    )



    fn CollapseMultiSubs =

    (

        for mat in getClassInstances MultiMaterial target:rootnode do

        (

            for i = 1 to mat.numsubs do

            (

                if mat[i] != undefined then

                (

                    uniqueMat = copy mat[i]

                    mat[i] = uniqueMat

                )

            )

        )



        for mat in getClassInstances MultiMaterial target:rootnode do

        (

            maxCount = 0

            maxMaterial = undefined



            for subMatIndex = 1 to mat.numsubs do

            (

                subMat = mat[subMatIndex]

                mCount = CountBitmapsFromMaterial subMat



                if mCount > maxCount do

                (

                    maxCount = mCount

                    maxMaterial = subMat

                )

            )



            if maxMaterial != undefined do

            (

                replaceInstances mat maxMaterial

                maxMaterial.name = mat.name

            )

        )

    )



    ----------------------------------

    -- Export GLB File(s)

    ----------------------------------



    fn ExportToGLB glbPath textField obj isCombined =

    (

        objSelected = false



        if (obj != undefined) and (isCombined == false) then

        (

            exportToGLBFile = glbPath + (SanitizeFilename obj.name) + ".glb"

            objSelected = true

        )



        if (obj != undefined) and (isCombined == true) then

        (

            if textField == "" then textField = "Unnamed"

            exportToGLBFile = glbPath + (SanitizeFilename textField) + ".glb"

            objSelected = true

        )



        if (obj == undefined) and (isCombined == false) then

        (

            if textField == "" then textField = "Unnamed"

            exportToGLBFile = glbPath + (SanitizeFilename textField) + ".glb"

        )



        exportFile exportToGLBFile #noPrompt selectedOnly:objSelected using:GLTF_Export

        if removeGlbLogFile then deleteFile (exportToGLBFile + ".log")

    )



    ----------------------------------

    -- Export to Groups (Scene)

    ----------------------------------



    -- Get bounding box dimensions (x, y, z) for an array of objects

    fn GetBoundingBoxSize objArray =

    (

        if classof objArray != Array then objArray = #(objArray)

        local minPt = [1e9, 1e9, 1e9]

        local maxPt = [-1e9, -1e9, -1e9]

        for obj in objArray where isValidNode obj and (superClassOf obj == GeometryClass) do

        (

            local bb = nodeGetBoundingBox obj (matrix3 1)

            local objMin = bb[1]

            local objMax = bb[2]

            if objMin.x < minPt.x do minPt.x = objMin.x

            if objMin.y < minPt.y do minPt.y = objMin.y

            if objMin.z < minPt.z do minPt.z = objMin.z

            if objMax.x > maxPt.x do maxPt.x = objMax.x

            if objMax.y > maxPt.y do maxPt.y = objMax.y

            if objMax.z > maxPt.z do maxPt.z = objMax.z

        )

        local x = maxPt.x - minPt.x

        local y = maxPt.y - minPt.y

        local z = maxPt.z - minPt.z

        return #(x, y, z)

    )



    -- Get position of an object or group head

    fn GetObjectPosition objArray =

    (

        if classof objArray != Array then objArray = #(objArray)

        if objArray.count == 1 then

        (

            return objArray[1].pos

        )

        else

        (

            for obj in objArray where isGroupHead obj do return obj.pos

            -- Fallback: center of bounding box

            local minPt = [1e9, 1e9, 1e9]

            local maxPt = [-1e9, -1e9, -1e9]

            for obj in objArray where isValidNode obj and (superClassOf obj == GeometryClass) do

            (

                local bb = nodeGetBoundingBox obj (matrix3 1)

                if bb[1].x < minPt.x do minPt.x = bb[1].x

                if bb[1].y < minPt.y do minPt.y = bb[1].y

                if bb[1].z < minPt.z do minPt.z = bb[1].z

                if bb[2].x > maxPt.x do maxPt.x = bb[2].x

                if bb[2].y > maxPt.y do maxPt.y = bb[2].y

                if bb[2].z > maxPt.z do maxPt.z = bb[2].z

            )

            return (minPt + maxPt) / 2.0

        )

    )



    -- Get quaternion rotation converted from 3ds Max (Z-up, left-hand rule)
    -- to Three.js (Y-up, right-hand rule). See GetObjectRotationYUp for full derivation.

    fn GetObjectRotationYUp objArray =

    (

        if classof objArray != Array then objArray = #(objArray)

        local q = quat 0 0 0 1

        local found = false

        -- Prefer group head rotation

        for obj in objArray while not found do

        (

            if isGroupHead obj then

            (

                q = obj.rotation

                found = true

            )

        )

        -- Fallback: first geometry node

        if not found do

        (

            for obj in objArray while not found do

            (

                if isValidNode obj and (superClassOf obj == GeometryClass) then

                (

                    q = obj.rotation

                    found = true

                )

            )

        )

        return (quat q.x q.z (-q.y) q.w)

    )



    -- Recursively collect all members of a group

    fn CollectGroupMembers groupHead =

    (

        local members = #(groupHead)

        for child in groupHead.children do

        (

            if isGroupHead child then

            (

                join members (CollectGroupMembers child)

            )

            else

            (

                append members child

            )

        )

        return members

    )



    -- Escape a string for JSON

    fn EscapeJsonString str =

    (

        str = substituteString str "\\" "\\\\"

        str = substituteString str "\"" "\\\""

        str = substituteString str "\n" "\\n"

        str = substituteString str "\r" "\\r"

        str = substituteString str "\t" "\\t"

        return str

    )



    -- Export selected nodes to a single .glb file

    fn ExportNodesToGLB glbPath fileName nodeArray =

    (

        fileName = SanitizeFilename fileName

        if fileName == "" do fileName = "node_" + (nodeArray[1].inode.handle as string)

        if glbPath.count > 0 and (substring glbPath glbPath.count 1 != "\\") do glbPath += "\\"

        clearSelection()

        select nodeArray

        local exportFilePath = glbPath + fileName + ".glb"

        exportFile exportFilePath #noPrompt selectedOnly:true using:GLTF_Export

        if removeGlbLogFile do deleteFile (exportFilePath + ".log")

        clearSelection()

        return (fileName + ".glb")

    )



    fn BuildExportMetadataRecord objectNode exportedName sizeArray positionValue rotationValue nodeArray =

    (

        local objectName = objectNode.name

        local objectId = substituteString (SanitizeFilename objectName) " " "-"

        local objectColor = GetMaterialColor nodeArray

        local modelUrl = "/models/" + exportedName

        -- entry indices:
        -- [1]  id
        -- [2]  name
        -- [3]  category
        -- [4]  shape
        -- [5]  size.x
        -- [6]  size.y
        -- [7]  size.z
        -- [8]  placementType
        -- [9]  color
        -- [10] modelUrl
        -- [11] position.x
        -- [12] position.y
        -- [13] position.z
        -- [14] rotation.x  (Three.js Y-up)
        -- [15] rotation.y  (Three.js Y-up)
        -- [16] rotation.z  (Three.js Y-up)
        -- [17] rotation.w  (Three.js Y-up)

        return #(objectId, objectName, "phong ngu", "model", sizeArray[1], sizeArray[2], sizeArray[3], "floor", objectColor, modelUrl, positionValue.x, positionValue.y, positionValue.z, rotationValue.x, rotationValue.y, rotationValue.z, rotationValue.w)

    )



    -- Main export groups function

    fn ExportGroupsScene glbPath =

    (

        if not doesFileExist glbPath do makeDir glbPath

        local metadata = #()

        local processedNodes = #{}



        -- First pass: export groups

        for obj in objects where (isGroupHead obj) and (obj.parent == undefined or not isGroupHead obj.parent) do

        (

            local groupMembers = CollectGroupMembers obj

            local groupName = obj.name

            for m in groupMembers do processedNodes[m.inode.handle] = true

            setGroupOpen obj true

            local exportedName = ExportNodesToGLB glbPath groupName groupMembers

            setGroupOpen obj false

            local pos = GetObjectPosition groupMembers

            local sz = GetBoundingBoxSize groupMembers

            local rot = GetObjectRotationYUp groupMembers

            append metadata (BuildExportMetadataRecord obj exportedName sz pos rot groupMembers)

        )



        -- Second pass: export ungrouped geometry

        for obj in objects where (superClassOf obj == GeometryClass) and (not isGroupHead obj) and (not isGroupMember obj) do

        (

            if processedNodes[obj.inode.handle] == false then

            (

                processedNodes[obj.inode.handle] = true

                local exportedName = ExportNodesToGLB glbPath obj.name #(obj)

                local pos = obj.pos

                local sz = GetBoundingBoxSize #(obj)

                local rot = GetObjectRotationYUp #(obj)

                append metadata (BuildExportMetadataRecord obj exportedName sz pos rot #(obj))

            )

        )



        -- Write metadata.json

        local jsonPath = glbPath + "metadata.json"

        local fStream = createFile jsonPath

        format "[\n" to:fStream

        for i = 1 to metadata.count do

        (

            local entry          = metadata[i]

            local id             = EscapeJsonString entry[1]

            local name           = EscapeJsonString entry[2]

            local category       = EscapeJsonString entry[3]

            local shape          = EscapeJsonString entry[4]

            local sx             = formattedPrint entry[5]  format:".4f"

            local sy             = formattedPrint entry[6]  format:".4f"

            local sz             = formattedPrint entry[7]  format:".4f"

            local placementType  = EscapeJsonString entry[8]

            local color          = EscapeJsonString entry[9]

            local modelUrl       = EscapeJsonString entry[10]

            local px             = formattedPrint entry[11] format:".4f"

            local py             = formattedPrint entry[12] format:".4f"

            local pz             = formattedPrint entry[13] format:".4f"

            local rx             = formattedPrint entry[14] format:".6f"

            local ry             = formattedPrint entry[15] format:".6f"

            local rz             = formattedPrint entry[16] format:".6f"

            local rw             = formattedPrint entry[17] format:".6f"

            format "  {\n"                                                                      to:fStream

            format "    \"id\": \"%\",\n"              id                                       to:fStream

            format "    \"name\": \"%\",\n"            name                                     to:fStream

            format "    \"category\": \"%\",\n"        category                                 to:fStream

            format "    \"shape\": \"%\",\n"           shape                                    to:fStream

            format "    \"size\": [%, %, %],\n"        sx sy sz                                 to:fStream

            format "    \"placementType\": \"%\",\n"   placementType                            to:fStream

            format "    \"color\": \"%\",\n"           color                                    to:fStream

            format "    \"modelUrl\": \"%\",\n"        modelUrl                                 to:fStream

            format "    \"position\": { \"x\": %, \"y\": %, \"z\": % },\n"    px py pz         to:fStream

            format "    \"rotation\": { \"x\": %, \"y\": %, \"z\": %, \"w\": % }\n" rx ry rz rw to:fStream

            if i < metadata.count then

                format "  },\n" to:fStream

            else

                format "  }\n" to:fStream

        )

        format "]\n" to:fStream

        close fStream

        free fStream

        messageBox ("Exported " + (metadata.count as string) + " GLB file(s) and metadata.json to:\n" + glbPath)

    )



    ----------------------------------

    -- Rollout UI

    ----------------------------------



    try(cui.UnRegisterDialogBar CoronaVrayToGLB)catch()

    try(DestroyDialog CoronaVrayToGLB)catch()



    rollout CoronaVrayToGLB ("Corona Vray To GLB " + scriptVersion)

    (

        -- UI Layout



        group "GLB Export Directory"

        (

            edittext et_path "" across:2 align:#left width:230 readonly:true

            button btn_browse "..." align:#right width:22 height:22 tooltip:"Change GLB Export Directory"

        )



        group "Settings"

        (

            checkbox chk_findTex "Find Missing Bitmaps" checked:true tooltip:"Search the directory for missing bitmaps. Example: If you have Sofa_BaseColor.png it will find Sofa_Occlusion.png if its in the same directory and bitmap prefix is the same, \"Sofa\" in this example. You must have at least one bitmap in the material."

            checkbox chk_glassToTrans "Convert Glass to Transmission" checked:true tooltip:"Enables Transmission for any material using Refraction.\n\nNOTE: Double check your glass materials since they may be set up in an unusual way originally."

            checkbox chk_GlbCompliant "Convert Textures to GLB Compliant" checked:true tooltip:"Converts bitmaps that are not compliant with GLB to .jpg (example .tif)"

            checkbox chk_invertGloss "Convert Glossiness Textures (slow)" checked:true tooltip:"Converts Glossiness Textures to Roughness textures.\n\nIf you already use Roughness workflow and textures then disable this.\n\nWARNING: This can take awhile since it needs to rebuild those bitmaps, renamed as texturename_inverted."

            checkbox chk_renameGltfMaps "Rename GLTF Maps" checked:true tooltip:"Renames GLTF Map nodes. Example: Base Color name = \"Base Color\" instead of \"Map #1\" or whatever you had previously"

            checkbox chk_rmLog "Remove GLB .log file" checked:true tooltip:"Deletes the .log file saved in the same directory as the .glb file after export"

            checkbox chk_rmSubdiv "Remove Subdivision Modifiers" checked:true tooltip:"Removes Modifiers Opensubdiv, Turbosmooth, Meshsmooth"

            checkbox chk_rmMultiSub "Collapse Multi-Sub Materials" checked:false tooltip:"WARNING: Replaces all materials in the Multi-Sub with the sub-material with the highest texture count.\n\nRecommended not to use this as its specific to my workflow. USE WITH CAUTION!"

            checkbox chk_hWarnings "Hide Warning Popups (Missing Textures)" checked:false tooltip:"Disables pop up messages regarding missing textures in materials. Still prints to maxscript listener for debugging"

        )



        group "Convert Materials"

        (

            checkbox chk_cSelMat "Convert Materials (Selected)" checked:true tooltip:"Convert materials of selected object only. Unchecked converts all scene materials to GLTF. \n\nNote: It will only convert the materials for your current render engine (example: Corona), so if you also need to change them for Vray then switch the render engine to Vray after conversion and press the button again"

            button btn_convertMtl "Convert Materials" tooltip:"Converts Vray or Corona materials to GLTF materials"

        )



        group "Export"

        (

            checkbox chk_xpSel "Export Selected (Individual)" checked:true tooltip:"Export selected objects only as indidual GLB files eg. Box001.glb Box002.glb etc"

            checkbox chk_xpSelCombine "Export Selected (Combined)" checked:false tooltip:"Export selected objects only as one combined .glb file. Set the file name yourself (WITHOUT the .glb extension)"

            checkbox chk_xpAll "Export All (Scene)" checked:false tooltip:"Export all mesh objects in the scene as one object and set the file name yourself (WITHOUT the .glb extension)"

            checkbox chk_xpGroups "Export to Groups (Scene)" checked:false tooltip:"Export groups as single .glb files, ungrouped objects as individual .glb files. Generates metadata.json with position, rotation (Three.js Y-up quaternion) and size for each exported file."

            edittext et_exportName "" tooltip:"Enter the GLB filename for all objects being exported (Do not add .glb in the filename)"

            button btn_exportGlb "Export GLB File(s)" tooltip:"Exports to the .glb file(s) to the Export Directory"

        )



        group "Customization"

        (

            button btn_saveSettings "Save Settings as Default" tooltip:"Save your own custom settings as default"

            button btn_restoreSettings "Restore Original Settings" tooltip:"Use original/default settings"

        )



        group "Contact"

        (

            label lbl_name "James Vella" align:#left

            hyperlink hyp_site "www.jamesvella.net" align:#left color:(color 92 216 157) hovercolor:(color 0 150 150) visitedcolor:(color 0 200 200) address:"https://www.jamesvella.net"

            label lbl_spacer1

            label lbl_info1 "If you like the script you can buy me a coffee :)" align:#left

            hyperlink hyp_donate "Donate" align:#left color:(color 92 216 157) hovercolor:(color 0 150 150) visitedcolor:(color 0 200 200) address:"https://www.paypal.com/donate/?hosted_button_id=GL9MAY2KZVJBC"

        )



        -- UI Functions



        -- Open UI --

        on CoronaVrayToGLB open do

        (

            -- load user saved settings

            if doesFileExist savedSettings then

            (

                fStream = openfile savedSettings

                while not eof fStream do

                (

                    et_path.text = readLine fStream

                    chk_findTex.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_renameGltfMaps.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_rmLog.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_rmSubdiv.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_rmMultiSub.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_hWarnings.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_cSelMat.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_xpSel.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_xpSelCombine.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_xpAll.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_glassToTrans.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_invertGloss.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_GlbCompliant.state = if not eof fStream then (readValue fStream) == 1 else false

                    chk_xpGroups.state = if not eof fStream then (readValue fStream) == 1 else false

                )

                close fStream

                free fStream

                ForceCompleteRedraw()



                if chk_xpSel.state then

                (

                    et_exportName.visible = false

                )

            )

            else

            (

                et_path.text = defaultExportDirectory

                et_exportName.text = ""

                et_exportName.visible = false

            )

        )



        -- GLB Export Directory

        on btn_browse pressed do

        (

            previousDirectory = et_path.text

            exportDirectory = getSavePath caption:"Save Directory"

            et_path.text = (exportDirectory as string) + @"\"



            if exportDirectory == undefined then et_path.text = previousDirectory

        )



        -- Convert Materials (button)

        on btn_convertMtl pressed do

        (

            if testMode == true then clearListener()



            if chk_renameGltfMaps.checked then renameGltfMaps = true else renameGltfMaps = false

            if chk_hWarnings.checked then hideWarningPopups = true else hideWarningPopups = false

            if chk_GlbCompliant.checked then convertGlbCompliant = true else convertGlbCompliant = false

            if chk_findTex.checked then findTextures = true else findTextures = false

            if chk_glassToTrans.checked then glassToTransmission = true else glassToTransmission = false

            if chk_invertGloss.checked then convertGlossinessMaps = true else glassToTransmission = false



            with undo on

            (

                if chk_rmSubdiv.checked then RemoveSubdivions()

                if chk_rmMultiSub.checked then CollapseMultiSubs()



                if chk_cSelMat.checked then

                (

                    convertSelectedMaterials = true



                    if convertSelectedMaterials then

                    (

                        for obj in selection where (selection.count > 0) do

                        (

                            theTarget = obj

                            ConvertCoronaVray()

                        )

                    )

                )

                else

                (

                    convertSelectedMaterials = false

                    theTarget = rootnode

                    ConvertCoronaVray()

                )

            )

            PrintMissingTextures()

        )



        -- Export (checkboxes) - mutual exclusivity

        on chk_xpSel changed state do

        (

            chk_xpSelCombine.checked = false

            chk_xpAll.checked = false

            chk_xpGroups.checked = false

            et_exportName.visible = false

        )



        on chk_xpSelCombine changed state do

        (

            chk_xpSel.checked = false

            chk_xpAll.checked = false

            chk_xpGroups.checked = false

            et_exportName.visible = state == true

        )



        on chk_xpAll changed state do

        (

            chk_xpSel.checked = false

            chk_xpSelCombine.checked = false

            chk_xpGroups.checked = false

            et_exportName.visible = state == true

        )



        on chk_xpGroups changed state do

        (

            chk_xpSel.checked = false

            chk_xpSelCombine.checked = false

            chk_xpAll.checked = false

            et_exportName.visible = false

        )



        -- Export GLB File(s) (button)

        on btn_exportGlb pressed do

        (

            if chk_rmLog.checked then removeGlbLogFile = true else removeGlbLogFile = false



            if chk_xpSel.checked then

            (

                for obj in selection do

                (

                    hide selection

                    unhide obj

                    ExportToGLB et_path.text et_exportName.text obj false

                    unhide selection

                )

            )

            else if chk_xpSelCombine.checked then

            (

                for obj in selection do

                (

                    ExportToGLB et_path.text et_exportName.text obj true

                    exit

                )

            )

            else if chk_xpAll.checked then

            (

                ExportToGLB et_path.text et_exportName.text undefined false

            )

            else if chk_xpGroups.checked then

            (

                ExportGroupsScene et_path.text

            )

            else if not (chk_xpSel.checked or chk_xpSelCombine.checked or chk_xpAll.checked or chk_xpGroups.checked) then

            (

                messageBox("You must pick one Export checkbox to export to GLB")

            )

        )



        -- Save Settings as Default (button)

        on btn_saveSettings pressed do

        (

            saveDirectory = getDir #userScripts + "\\Vella"

            if not doesDirectoryExist saveDirectory do makeDir saveDirectory



            fStream = createFile savedSettings



            format "%\n" et_path.text to:fStream

            format "%\n" (if chk_findTex.state then 1 else 0) to:fStream

            format "%\n" (if chk_renameGltfMaps.state then 1 else 0) to:fStream

            format "%\n" (if chk_rmLog.state then 1 else 0) to:fStream

            format "%\n" (if chk_rmSubdiv.state then 1 else 0) to:fStream

            format "%\n" (if chk_rmMultiSub.state then 1 else 0) to:fStream

            format "%\n" (if chk_hWarnings.state then 1 else 0) to:fStream

            format "%\n" (if chk_cSelMat.state then 1 else 0) to:fStream

            format "%\n" (if chk_xpSel.state then 1 else 0) to:fStream

            format "%\n" (if chk_xpSelCombine.state then 1 else 0) to:fStream

            format "%\n" (if chk_xpAll.state then 1 else 0) to:fStream

            format "%\n" (if chk_glassToTrans.state then 1 else 0) to:fStream

            format "%\n" (if chk_invertGloss.state then 1 else 0) to:fStream

            format "%\n" (if chk_GlbCompliant.state then 1 else 0) to:fStream

            format "%\n" (if chk_xpGroups.state then 1 else 0) to:fStream



            close fStream

            free fStream

            ForceCompleteRedraw()

        )



        -- Restore Original Settings (button)

        on btn_restoreSettings pressed do

        (

            if doesFileExist savedSettings then deleteFile savedSettings



            et_path.text = defaultExportDirectory

            chk_findTex.checked = false

            chk_renameGltfMaps.checked = true

            chk_rmLog.checked = true

            chk_rmSubdiv.checked = true

            chk_rmMultiSub.checked = false

            chk_hWarnings.checked = false

            chk_cSelMat.checked = true

            chk_xpSel.checked = true

            chk_xpSelCombine.checked = false

            chk_xpAll.checked = false

            chk_xpGroups.checked = false

            et_exportName.visible = false

            chk_glassToTrans.checked = false

            chk_invertGloss.checked = true

            chk_GlbCompliant.checked = true

        )

    )



    if testMode == false then

    (

        CreateDialog CoronaVrayToGLB POS:[100,200] width:300 height:700

        cui.RegisterDialogBar CoronaVrayToGLB

    )

    else

    (

        CreateDialog CoronaVrayToGLB POS:[100,200] width:300 height:700

        cui.RegisterDialogBar CoronaVrayToGLB

        CoronaVrayToGLB.btn_convertMtl.pressed()

        try(cui.UnRegisterDialogBar CoronaVrayToGLB)catch()

        try(DestroyDialog CoronaVrayToGLB)catch()

    )

)

