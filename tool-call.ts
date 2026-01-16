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
    },
    {
        type: 'function',
        function: {
            name: 'calculate_total_price',
            description: 'Calculate the total price with tax',
            parameters: {
                type: 'object',
                properties: {
                    price: {
                        type: 'number',
                        description: 'The base price of the item',
                    },
                    tax_rate: {
                        type: 'number',
                        description: 'The tax rate as a decimal (e.g., 0.08 for 8%)',
                    },
                },
                required: ['price', 'tax_rate'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_database',
            description: 'Search for information in a database',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query',
                    },
                    filters: {
                        type: 'object',
                        description: 'Optional filters for the search',
                        properties: {
                            category: { type: 'string' },
                            min_date: { type: 'string' },
                        },
                    },
                },
                required: ['query'],
            },
        },
    },
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

//impliment the caculatate total price function
function calculateTotalPrice(price: number, taxRate: number): string {
    const total = price + (price * taxRate);
    return JSON.stringify({
        base_price: price,
        tax_rate: taxRate,
        tax_amount: price * taxRate,
        total: total,
    });
}

//impliment the search database function
function searchDatabase(query: string, filters?: any): string {
    // Simulated database search
    return JSON.stringify({
        query,
        filters,
        results: [
            { id: 1, title: 'Result 1', relevance: 0.95 },
            { id: 2, title: 'Result 2', relevance: 0.87 },
        ],
        total_results: 2,
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
        case 'calculate_total_price':
            return calculateTotalPrice(
                functionArgs.price,
                functionArgs.tax_rate
            );
        case 'search_database':
            return searchDatabase(
                functionArgs.query,
                functionArgs.filters
            )

        default:
            throw new Error(`Unknown function: ${functionName}`);
    }
}


async function runToolCallingExample() {

    console.log('OpenAI Tool Calling Demo\n');

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
            role: 'user',
            content: 'What\'s the weather like in Lagos, Nigeria? Also, if something costs $100 with 8% tax, what\'s the total?'
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

            console.log(`\n Executing: ${functionName}`);
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

// Advanced example: Handling multiple conversation turns
async function runMultiTurnExample() {
    console.log('\n\n Multi-Turn Conversation Example\n');

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
            role: 'system',
            content: 'You are a helpful assistant with access to weather data, calculation tools, and database search',
        },
    ];

    // Simulate a conversation
    const userQueries = [
        'What\'s the weather in Lagos, Nigeria?',
        'Convert that temperature to Celsius',
        'If a jacket costs $89.99 with 7.5% tax, what would I pay?',
    ];

    for (const query of userQueries) {
        console.log('\n User:', query);
        messages.push({ role: 'user', content: query });

        let response = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: messages,
            tools: tools,
            tool_choice: 'auto',
        });

        let assistantMessage = response.choices[0].message;
        messages.push(assistantMessage);

        // Handle tool calls if any
        if (assistantMessage.tool_calls) {
            console.log('Processing tool calls...');

            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.type !== 'function' || !toolCall.function) {
                    continue;
                }

                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                console.log(`\n Executing: ${functionName}`);
                console.log('Arguments:', functionArgs);

                const functionResponse = await executeFunctionCall(functionName, functionArgs);
                console.log('Response:', functionResponse);

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: functionResponse,
                });
            }

            // Get final response
            response = await openai.chat.completions.create({
                model: 'openai/gpt-4o-mini',
                messages: messages,
            });

            assistantMessage = response.choices[0].message;
            messages.push(assistantMessage);
        }

        console.log('Assistant:', assistantMessage.content);
    }
}

async function runErrorHandlingExample() {
    console.log('\n\nError Handling Example\n');

    try {
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'user', content: 'What\'s the weather in Mars?' },
        ];

        const response = await openai.chat.completions.create({
            model: 'openai/gpt-4o-mini',
            messages: messages,
            tools: tools,
            tool_choice: 'auto',
        });

        const assistantMessage = response.choices[0].message;

        if (assistantMessage.tool_calls) {
            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.type !== 'function' || !toolCall.function) {
                    continue;
                }

                const functionName = toolCall.function.name;
                let functionArgs;

                try {
                    functionArgs = JSON.parse(toolCall.function.arguments);
                } catch (parseError) {
                    console.error('Failed to parse function arguments:', parseError);
                    continue;
                }

                try {
                    const functionResponse = executeFunctionCall(functionName, functionArgs);
                    console.log('Function executed successfully:', functionName);
                    console.log('Result:', functionResponse);
                } catch (execError) {
                    console.error('Function execution error:', execError);
                }
            }
        }
    } catch (error) {
        if (error instanceof OpenAI.APIError) {
            console.error('OpenAI API Error:');
            console.error('Status:', error.status);
            console.error('Message:', error.message);
        } else {
            console.error('Unexpected error:', error);
        }
    }
}

async function runStreamingExample() {
    console.log('\n\nStreaming with Tool Calls Example\n');

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
            role: 'user',
            content: 'What\'s the weather in London and calculate the total for $50 with 10% tax?',
        },
    ];

    console.log('User:', messages[0].content);
    console.log('Assistant: ', '');

    const stream = await openai.chat.completions.create({
        model: 'openai/gpt-4o-mini',
        messages: messages,
        tools: tools,
        stream: true,
    });

    let toolCalls: any[] = [];
    let currentToolCall: any = null;

    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
                if (toolCallDelta.index !== undefined) {
                    if (!toolCalls[toolCallDelta.index]) {
                        toolCalls[toolCallDelta.index] = {
                            id: '',
                            type: 'function',
                            function: { name: '', arguments: '' },
                        };
                    }

                    currentToolCall = toolCalls[toolCallDelta.index];

                    if (toolCallDelta.id) currentToolCall.id = toolCallDelta.id;
                    if (toolCallDelta.function?.name) {
                        currentToolCall.function.name += toolCallDelta.function.name;
                    }
                    if (toolCallDelta.function?.arguments) {
                        currentToolCall.function.arguments += toolCallDelta.function.arguments;
                    }
                }
            }
        }

        if (delta?.content) {
            process.stdout.write(delta.content);
        }
    }

    console.log('\n');

    if (toolCalls.length > 0) {
        console.log('Tool calls detected in stream');
        for (const toolCall of toolCalls) {
            console.log(`  - ${toolCall.function.name}:`, toolCall.function.arguments);
        }
    }
}


// Main execution
async function main() {
    try {
        // Run all examples
        // await runToolCallingExample();
        // await runMultiTurnExample();
        // await runErrorHandlingExample();
        await runStreamingExample();

        console.log('\n\n All examples completed!');
        console.log('\n Key Takeaways:');
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
    calculateTotalPrice,
    searchDatabase
};