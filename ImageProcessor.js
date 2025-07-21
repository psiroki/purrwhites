export class ImageProcessor {
    constructor(imageBitmap, useLinearColorSpace = false) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = imageBitmap.width;
        this.canvas.height = imageBitmap.height;
        this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true }) || 
                  this.canvas.getContext('webgl', { preserveDrawingBuffer: true });
        
        if (!this.gl) {
            throw new Error('WebGL is not supported');
        }

        // Check NPOT texture support
        const isWebGL2 = this.gl instanceof WebGL2RenderingContext;
        if (!isWebGL2 && !this.gl.getExtension('OES_texture_npot')) {
            throw new Error('Non-power-of-two textures are not supported');
        }

        const maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
        if (imageBitmap.width > maxTextureSize || imageBitmap.height > maxTextureSize) {
            throw new Error('Image dimensions exceed maximum texture size');
        }

        this.imageBitmap = imageBitmap; // Store for sampling
        this.useLinearColorSpace = useLinearColorSpace;
        this.multiplier = [1.0, 1.0, 1.0];
        this.bias = [0.0, 0.0, 0.0];
        this.sampleSize = 3; // Default sampling square size (3x3 pixels)

        // Initialize sampling canvas
        this.sampleCanvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(this.sampleSize, this.sampleSize)
            : document.createElement('canvas');
        this.sampleCanvas.width = this.sampleSize;
        this.sampleCanvas.height = this.sampleSize;
        this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });

        this.#initWebGL(imageBitmap);
    }

    #initWebGL(imageBitmap) {
        const gl = this.gl;

        // Create and compile shaders
        const vertexShader = this.#createShader(gl.VERTEX_SHADER, `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `);

        const fragmentShader = this.#createShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_texture;
            uniform vec3 u_multiplier;
            uniform vec3 u_bias;
            uniform bool u_useLinearColorSpace;
            
            vec3 srgbToLinear(vec3 color) {
                return pow(color, vec3(2.2));
            }
            
            vec3 linearToSrgb(vec3 color) {
                return pow(color, vec3(1.0/2.2));
            }
            
            void main() {
                vec4 texelColor = texture2D(u_texture, v_texCoord);
                vec3 color = texelColor.rgb;
                
                if (u_useLinearColorSpace) {
                    color = srgbToLinear(color);
                    color = color * u_multiplier + u_bias;
                    color = linearToSrgb(color);
                } else {
                    color = color * u_multiplier + u_bias;
                }
                
                gl_FragColor = vec4(color, texelColor.a);
            }
        `);

        // Create and link program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error('Program linking failed: ' + gl.getProgramInfoLog(this.program));
        }

        // Set up geometry
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, 1,  0, 0,
             1, 1,  1, 0,
            -1, -1,  0, 1,
             1, -1,  1, 1
        ]), gl.STATIC_DRAW);

        // Set up texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageBitmap);
        
        // NPOT texture settings
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Get uniform locations
        gl.useProgram(this.program);
        this.multiplierLoc = gl.getUniformLocation(this.program, 'u_multiplier');
        this.biasLoc = gl.getUniformLocation(this.program, 'u_bias');
        this.linearColorSpaceLoc = gl.getUniformLocation(this.program, 'u_useLinearColorSpace');

        // Set initial uniforms
        gl.uniform3fv(this.multiplierLoc, this.multiplier);
        gl.uniform3fv(this.biasLoc, this.bias);
        gl.uniform1i(this.linearColorSpaceLoc, this.useLinearColorSpace);

        // Set up attributes
        const positionLoc = gl.getAttribLocation(this.program, 'a_position');
        const texCoordLoc = gl.getAttribLocation(this.program, 'a_texCoord');
        
        gl.enableVertexAttribArray(positionLoc);
        gl.enableVertexAttribArray(texCoordLoc);
        
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 16, 8);

        // Initial render
        this.#render();
    }

    #createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error('Shader compilation failed: ' + gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    #render() {
        const gl = this.gl;
        
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.useProgram(this.program);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    setMultiplier(rgb) {
        if (rgb.length !== 3 || rgb.some(v => isNaN(v))) {
            throw new Error('Multiplier must be an array of 3 numbers');
        }
        this.multiplier = rgb;
        this.gl.uniform3fv(this.multiplierLoc, rgb);
        this.#render();
    }

    setBias(rgb) {
        if (rgb.length !== 3 || rgb.some(v => isNaN(v))) {
            throw new Error('Bias must be an array of 3 numbers');
        }
        this.bias = rgb;
        this.gl.uniform3fv(this.biasLoc, rgb);
        this.#render();
    }

    setLinearColorSpace(useLinear) {
        this.useLinearColorSpace = !!useLinear;
        this.gl.uniform1i(this.linearColorSpaceLoc, this.useLinearColorSpace);
        this.#render();
    }

    setSampleSize(size) {
        if (!Number.isInteger(size) || size <= 0) {
            throw new Error('Sample size must be a positive integer');
        }
        this.sampleSize = size;
        // Resize canvas only if size exceeds current dimensions and is larger than 64
        if (size > Math.min(this.sampleCanvas.width, 64)) {
            this.sampleCanvas.width = size;
            this.sampleCanvas.height = size;
        }
    }

    sampleRegion(x, y) {
        // Clamp coordinates to ensure the sample region fits within the image
        const size = Math.min(this.sampleSize, this.sampleCanvas.width);
        const clampedX = Math.max(0, Math.min(this.canvas.width - size, Math.floor(x - size / 2)));
        const clampedY = Math.max(0, Math.min(this.canvas.height - size, Math.floor(y - size / 2)));

        // Draw the image region to the sample canvas
        this.sampleCtx.clearRect(0, 0, this.sampleCanvas.width, this.sampleCanvas.height);
        this.sampleCtx.drawImage(this.imageBitmap, clampedX, clampedY, size, size, 0, 0, size, size);

        // Get pixel data
        const imageData = this.sampleCtx.getImageData(0, 0, size, size);
        const data = imageData.data;

        // Compute average RGB
        let r = 0, g = 0, b = 0;
        const pixelCount = size * size;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
        }
        r /= pixelCount;
        g /= pixelCount;
        b /= pixelCount;

        return { r: r / 255, g: g / 255, b: b / 255 }; // Normalized to [0, 1]
    }
}
