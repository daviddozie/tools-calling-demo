import OpenAI from "openai";
import { config } from "dotenv";

config();


//Initials OpenAI Client
const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: process.env.OPENROUTER_API_BASE_URL || 'https://openrouter.ai/api/v1',
});

const MODEL_NAME = 'nvidia/nemotron-3-nano-30b-a3b:free'

//Define the tools (functions that the LLM can call)
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'get_current_weather',
            description: 'get the current weather in a given location',
            parameters: {
                type: 'object',
                properties: {
                    location: {
                        type: 'string',
                        description: 'The city and state, e.g. San Francisco, CA'
                    },
                    unit: {
                        type: 'string',
                        enum: ['celsius', 'fahrenheit'],
                        description: 'the temparature unit to use',
                    },
                },
                required: ['location'],
            },
        },
    }
]

//Impliment the actual functions
async function getCurrentWeather(
    location: string,
    unit: 'celsius' | 'fahrenheit' = 'fahrenheit'
): Promise<string> {
    const apiKey = process.env.VISUAL_CROSSING_API_KEY;
    if (!apiKey) {
        throw new Error('Missing VISUAL_CROSSING_API_KEY');
    }

    // Unit group based on user preference
    const unitGroup = unit === 'celsius' ? 'metric' : 'us';

    // Build URL using the location directly
    const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(
        location
    )}?unitGroup=${unitGroup}&include=current&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Weather API error: ${res.statusText}`);
    }

    const data = await res.json();

    const current = data.currentConditions;

    return JSON.stringify({
        location,
        temperature: current.temp,
        unit,
        condition: current.conditions,
        humidity: current.humidity,
        wind_speed: current.windspeed,
    });
}

async function executeFunctionCall(
    functionName: string,
    functionArgs: Record<string, any>
): Promise<string> {
    switch (functionName) {
        case 'get_current_weather':
            return getCurrentWeather(
                functionArgs.location,
                functionArgs.unit
            );

        default:
            throw new Error(`Unknown function: ${functionName}`);
    }
}


async function runToolCallingExample() {

    console.log('OpenAI Tool Calling Demo\n');

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
            role: 'user',
            content: 'What\'s the weather like in Lagos, Nigeria?'
        },
    ];

    console.log('User Query:', messages[0].content);
    console.log('\n---\n');

    // Step 1: Make initial API call with tools
    let response = await openai.chat.completions.create({
        model: MODEL_NAME,
        messages: messages,
        tools: tools,
        tool_choice: 'auto', // Let the model decide when to use tools
    });

    let responseMessage = response.choices[0].message;
    console.log('Model Response:');
    console.log('Finish Reason:', response.choices[0].finish_reason);

    // Add assistant's response to messages
    messages.push(responseMessage);

    // Step 2: Check if the model wants to call any functions
    if (responseMessage.tool_calls) {
        console.log('\nTool Calls Requested:', responseMessage.tool_calls.length);

        // Execute the tool call
        for (const toolCall of responseMessage.tool_calls) {
            if (toolCall.type !== 'function' || !toolCall.function) {
                continue;
            }

            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);

            console.log(`\n🔨 Executing: ${functionName}`);
            console.log('Arguments:', functionArgs);

            const functionResponse = await executeFunctionCall(functionName, functionArgs);
            console.log('Response:', functionResponse);

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: functionResponse,
            });
        }

        // Step 3: Make second API call with function results
        console.log('\n---\n');
        console.log('Sending tool results back to model...\n');

        const secondResponse = await openai.chat.completions.create({
            model: 'openai/gpt-4o-mini',
            messages: messages,
        });

        const finalMessage = secondResponse.choices[0].message;
        console.log('Final Response:');
        console.log(finalMessage.content);
    } else {
        // No tools were called, just print the response
        console.log('Direct Response:');
        console.log(responseMessage.content);
    }
}

// Main execution
async function main() {
    try {
        // Run all examples
        await runToolCallingExample();

        console.log('\n\n All examples completed!');
        console.log('\n📚 Key Takeaways:');
        console.log('1. Define tools with clear descriptions and parameters');
        console.log('2. Let the model decide when to use tools (tool_choice: "auto")');
        console.log('3. Execute tool calls and send results back to the model');
        console.log('4. Handle multi-turn conversations by maintaining message history');
        console.log('5. Streaming is supported with tool calls');
        console.log('6. Always implement proper error handling');
    } catch (error) {
        console.error('Error running examples:', error);
        process.exit(1);
    }
}

// Run the examples
main();

// Export for use in other modules
export {
    tools,
    getCurrentWeather,
};