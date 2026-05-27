import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { FormattedHTMLMessage } from 'app/Translator';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { api } from '@steemit/steem-js';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';

class PublishPriceFeed extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            base: '1.000 SBD',
            quote: '',
            loading: false,
            loadingWitnessData: false,
            loadingCurrentPrice: false,
            error: null,
            success: null,
            isWitness: true,
            currentMedianBase: '',
            currentMedianQuote: '',
            livePriceLabel: '',
            currentMedianReadableLabel: '',
        };

        this.priceSummaryFrame = null;
        this.priceSummaryTimeout = null;

        this.onChange = this.onChange.bind(this);
        this.onSubmit = this.onSubmit.bind(this);
        this.onGetCurrentPrice = this.onGetCurrentPrice.bind(this);
        this.onFailure = this.onFailure.bind(this);
        this.onSuccess = this.onSuccess.bind(this);
        this.loadWitnessStatus = this.loadWitnessStatus.bind(this);
        this.scheduleDerivedDisplayUpdate = this.scheduleDerivedDisplayUpdate.bind(this);
        this.updateDerivedDisplay = this.updateDerivedDisplay.bind(this);
        this.cancelDerivedDisplayUpdate = this.cancelDerivedDisplayUpdate.bind(this);
    }

    componentDidMount() {
        this.loadWitnessStatus(this.props);
        this.onGetCurrentPrice(true);
        this.scheduleDerivedDisplayUpdate();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.accountName !== this.props.accountName) {
            this.loadWitnessStatus(this.props);
        }
    }

    componentWillUnmount() {
        this.cancelDerivedDisplayUpdate();
    }

    onChange(e) {
        const { name, value } = e.target;
        this.setState(
            {
                [name]: value,
                error: null,
                success: null,
            },
            () => {
                this.scheduleDerivedDisplayUpdate();
            }
        );
    }

    cancelDerivedDisplayUpdate() {
        if (this.priceSummaryFrame && typeof window !== 'undefined' && window.cancelAnimationFrame) {
            window.cancelAnimationFrame(this.priceSummaryFrame);
            this.priceSummaryFrame = null;
        }
        if (this.priceSummaryTimeout) {
            clearTimeout(this.priceSummaryTimeout);
            this.priceSummaryTimeout = null;
        }
    }

    scheduleDerivedDisplayUpdate() {
        this.cancelDerivedDisplayUpdate();

        const runner = () => {
            this.priceSummaryFrame = null;
            this.priceSummaryTimeout = null;
            this.updateDerivedDisplay();
        };

        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            this.priceSummaryFrame = window.requestAnimationFrame(runner);
        } else {
            this.priceSummaryTimeout = setTimeout(runner, 0);
        }
    }

    parseAssetAmount(value, symbol) {
        const cleanValue = String(value || '')
            .replace(` ${symbol}`, '')
            .replace(symbol, '')
            .trim();

        if (!cleanValue) {
            return null;
        }

        const parsed = parseFloat(cleanValue);
        return Number.isFinite(parsed) ? parsed : null;
    }

    formatReadableNumber(value, digits = 3) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return '';
        }

        const fixed = numeric.toFixed(digits);
        const [integerPart, decimalPart] = fixed.split('.');
        const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

        return decimalPart ? `${groupedInteger}.${decimalPart}` : groupedInteger;
    }

    updateDerivedDisplay() {
        const { base, quote, currentMedianBase, currentMedianQuote } = this.state;

        const baseAmount = this.parseAssetAmount(base, 'SBD');
        const quoteAmount = this.parseAssetAmount(quote, 'STEEM');

        let livePriceLabel = '';
        if (
            Number.isFinite(baseAmount) &&
            Number.isFinite(quoteAmount) &&
            quoteAmount > 0
        ) {
            const ratio = baseAmount / quoteAmount;
            livePriceLabel = `1 STEEM ≈ ${ratio.toFixed(3)} SBD`;
        }

        const rawBaseAmount = this.parseAssetAmount(currentMedianBase, 'SBD');
        const rawQuoteAmount = this.parseAssetAmount(currentMedianQuote, 'STEEM');

        let currentMedianReadableLabel = '';
        if (
            Number.isFinite(rawBaseAmount) &&
            Number.isFinite(rawQuoteAmount)
        ) {
            currentMedianReadableLabel =
                `Current blockchain median: ` +
                `${this.formatReadableNumber(rawBaseAmount)} SBD / ` +
                `${this.formatReadableNumber(rawQuoteAmount)} STEEM. 1 STEEM ≈ ${ratio.toFixed(3)} SBD.`;
        }

        this.setState({
            livePriceLabel,
            currentMedianReadableLabel,
        });
    }

    async loadWitnessStatus(props = this.props) {
        const { accountName } = props;

        if (!accountName) {
            return;
        }

        this.setState({
            loadingWitnessData: true,
            error: null,
            success: null,
        });

        try {
            const witness = await api.getWitnessByAccountAsync(accountName);
            this.setState({
                isWitness: !!witness,
                loadingWitnessData: false,
            });
        } catch (error) {
            this.setState({
                loadingWitnessData: false,
                error: tt('steem_tools.publish_price_feed.error_loading_witness'),
                success: null,
            });
        }
    }

    async onGetCurrentPrice(isAutoLoad = false) {
        this.setState({
            loadingCurrentPrice: true,
            error: null,
            success: null,
        });

        try {
            const feedHistory = await api.getFeedHistoryAsync();
            const currentMedianHistory = feedHistory && feedHistory.current_median_history
                ? feedHistory.current_median_history
                : null;

            const currentMedianBase = currentMedianHistory && currentMedianHistory.base
                ? currentMedianHistory.base
                : '';

            const currentMedianQuote = currentMedianHistory && currentMedianHistory.quote
                ? currentMedianHistory.quote
                : '';

            const rawBaseAmount = this.parseAssetAmount(currentMedianBase, 'SBD');
            const rawQuoteAmount = this.parseAssetAmount(currentMedianQuote, 'STEEM');

            let nextBase = this.state.base;
            let nextQuote = this.state.quote;

            if (
                Number.isFinite(rawBaseAmount) &&
                Number.isFinite(rawQuoteAmount) &&
                rawQuoteAmount > 0
            ) {
                const normalizedRatio = rawBaseAmount / rawQuoteAmount;
                nextBase = `${normalizedRatio.toFixed(3)} SBD`;
                nextQuote = '1.000 STEEM';
            }

            this.setState(
                {
                    base: nextBase,
                    quote: nextQuote,
                    currentMedianBase,
                    currentMedianQuote,
                    loadingCurrentPrice: false,
                    success: isAutoLoad === true
                        ? null
                        : tt('steem_tools.publish_price_feed.current_price_loaded'),
                },
                () => {
                    this.scheduleDerivedDisplayUpdate();
                }
            );
        } catch (error) {
            this.setState({
                loadingCurrentPrice: false,
                error: isAutoLoad === true
                    ? null
                    : tt('steem_tools.publish_price_feed.error_loading_current_price'),
                success: null,
            });
        }
    }

    onFailure(error) {
        let errorMessage = error;
        if (
            !errorMessage ||
            errorMessage === 0 ||
            errorMessage === false ||
            String(errorMessage).toLowerCase().includes('undefined')
        ) {
            errorMessage = tt('steem_tools.publish_price_feed.unexpected_error');
        }

        this.setState({
            loading: false,
            error: errorMessage,
            success: null,
        });
    }

    onSuccess() {
        const { currentUser, refreshAccount } = this.props;
        refreshAccount(currentUser);
        this.setState({
            loading: false,
            error: null,
            success: tt('steem_tools.publish_price_feed.success_message'),
        });
    }

    isValidAssetString(value, symbol) {
        const pattern = new RegExp(`^\\d+\\.\\d{3}\\s${symbol}$`);
        return pattern.test(String(value || '').trim());
    }

    onSubmit() {
        const { currentUser, accountName, publishPriceFeed } = this.props;
        const { base, quote, isWitness } = this.state;

        if (!currentUser) {
            this.setState({
                error: tt('steem_tools.publish_price_feed.error_no_account'),
                success: null,
            });
            return;
        }

        if (!accountName) {
            this.setState({
                error: tt('steem_tools.publish_price_feed.error_no_target_account'),
                success: null,
            });
            return;
        }

        if (currentUser !== accountName) {
            this.setState({
                error: tt('steem_tools.publish_price_feed.error_not_allowed'),
                success: null,
            });
            return;
        }

        if (!isWitness) {
            this.setState({
                error: tt('steem_tools.publish_price_feed.error_not_witness'),
                success: null,
            });
            return;
        }

        let finalBase = base.replace(' SBD', '').trim();
        if (finalBase && !isNaN(finalBase)) {
            finalBase = `${parseFloat(finalBase).toFixed(3)} SBD`;
        } else {
            finalBase = base;
        }

        let finalQuote = quote.replace(' STEEM', '').trim();
        if (finalQuote && !isNaN(finalQuote)) {
            finalQuote = `${parseFloat(finalQuote).toFixed(3)} STEEM`;
        } else {
            finalQuote = quote;
        }

        if (!this.isValidAssetString(finalBase, 'SBD')) {
            this.setState({
                error: tt('steem_tools.publish_price_feed.error_invalid_base'),
                success: null,
            });
            return;
        }

        if (!this.isValidAssetString(finalQuote, 'STEEM')) {
            this.setState({
                error: tt('steem_tools.publish_price_feed.error_invalid_quote'),
                success: null,
            });
            return;
        }

        this.setState({
            loading: true,
            error: null,
            success: null,
        });

        publishPriceFeed(
            accountName,
            finalBase,
            finalQuote,
            this.onSuccess,
            this.onFailure
        );
    }

    render() {
        const { currentUser, accountName } = this.props;
        const {
            base,
            quote,
            loading,
            loadingWitnessData,
            loadingCurrentPrice,
            error,
            success,
            isWitness,
            livePriceLabel,
            currentMedianReadableLabel,
        } = this.state;

        const isOwner =
            !!currentUser &&
            !!accountName &&
            currentUser === accountName;

        const canEdit = !loading && !loadingWitnessData && !loadingCurrentPrice && isOwner && isWitness;

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">{tt('steem_tools.publish_price_feed.title')}</h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.publish_price_feed.description"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div style={{ marginTop: 14 }}>
                        <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.publish_price_feed.witness_account')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '0.25rem' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        type="text"
                                        value={accountName || ''}
                                        disabled
                                        className="input-group-field bold"
                                    />
                                </div>
                                {!loadingWitnessData ? (
                                    <div className="change-recovery-account-hint" style={{ marginTop: 0, marginBottom: 0 }}>
                                        {isWitness
                                            ? tt('steem_tools.publish_price_feed.witness_status_yes')
                                            : tt('steem_tools.publish_price_feed.witness_status_no')}
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.publish_price_feed.base')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <input
                                        className="input-group-field bold"
                                        type="number"
                                        step="0.001"
                                        min="0"
                                        name="base"
                                        value={base.replace(' SBD', '')}
                                        onChange={(e) => this.onChange({ target: { name: 'base', value: `${e.target.value} SBD` } })}
                                        disabled={!canEdit}
                                        placeholder={tt('steem_tools.publish_price_feed.base_placeholder')}
                                    />
                                    <span className="input-group-label">SBD</span>
                                </div>
                            </div>
                        </div>

                        <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.publish_price_feed.quote')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '0.25rem' }}>
                                    <input
                                        className="input-group-field bold"
                                        type="number"
                                        step="0.001"
                                        min="0"
                                        name="quote"
                                        value={quote.replace(' STEEM', '')}
                                        onChange={(e) => this.onChange({ target: { name: 'quote', value: `${e.target.value} STEEM` } })}
                                        disabled={!canEdit}
                                        placeholder={tt('steem_tools.publish_price_feed.quote_placeholder')}
                                    />
                                    <span className="input-group-label">STEEM</span>
                                </div>

                                <div className="change-recovery-account-hint" style={{ marginTop: 0, marginBottom: 0 }}>
                                    {tt('steem_tools.publish_price_feed.quote_hint')}
                                </div>
                            </div>
                        </div>

                    {currentMedianReadableLabel ? (
                        <div
                            className="change-recovery-account-hint"
                            style={{ marginTop: 0, marginBottom: '0.25rem' }}
                        >
                            {currentMedianReadableLabel}
                        </div>
                    ) : null}

                        {!loading && !loadingWitnessData && !loadingCurrentPrice && !isOwner && currentUser && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt('steem_tools.publish_price_feed.error_not_allowed')}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && !loadingWitnessData && !loadingCurrentPrice && isOwner && !isWitness && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt('steem_tools.publish_price_feed.error_not_witness')}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && !loadingWitnessData && !loadingCurrentPrice && error ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">{error}</div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && !loadingWitnessData && !loadingCurrentPrice && success ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-success">{success}</div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row">
                            <div className="column">
                                {loading || loadingWitnessData || loadingCurrentPrice ? (
                                    <span>
                                        <LoadingIndicator type="circle" />
                                    </span>
                                ) : (
                                    <span>
                                        <button
                                            type="button"
                                            className="button advtools-btn-primary"
                                            onClick={this.onSubmit}
                                            disabled={!canEdit}
                                        >
                                            {tt('steem_tools.publish_price_feed.publish_btn')}
                                        </button>
                                        &nbsp;&nbsp;&nbsp;
                                        <button
                                            type="button"
                                            className="button hollow advtools-btn-primary"
                                            onClick={() => this.onGetCurrentPrice(false)}
                                            disabled={loading || loadingWitnessData}
                                        >
                                            {tt('steem_tools.publish_price_feed.get_current_price_btn')}
                                        </button>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const user = state.user.get('current');
        const currentUser = user && user.get('username');

        const accountName =
            ownProps.accountname ||
            currentUser ||
            '';

        const account = accountName
            ? state.global.getIn(['accounts', accountName])
            : null;

        return {
            currentUser,
            accountName,
            account,
        };
    },
    dispatch => ({
        publishPriceFeed: (
            publisher,
            base,
            quote,
            successCallback,
            errorCallback
        ) => {
            const successCb = () => {
                dispatch(globalActions.getState({ url: `@${publisher}/witnesses` }));
                if (successCallback) successCallback();
            };

            const operation = {
                publisher,
                exchange_rate: {
                    base,
                    quote,
                },
            };

            const conf = tt('steem_tools.publish_price_feed.confirm_broadcast_message', {
                account: publisher,
                base,
                quote,
            });

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'feed_publish',
                    operation,
                    confirm: conf + '?',
                    successCallback: successCb,
                    errorCallback,
                })
            );
        },
        refreshAccount: username =>
            dispatch(
                userActions.refreshAccount({
                    username,
                })
            ),
        removeNotification: key =>
            dispatch(appActions.removeNotification({ key })),
    })
)(PublishPriceFeed);
