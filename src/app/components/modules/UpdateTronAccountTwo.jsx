import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
import PdfDownload from 'app/components/elements/PdfDownload';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'row',
        flexFlow: 'row wrap',
        marginTop: '40px',
    },
    flowBelow: {
        marginTop: '40px',
    },
};
// todo: refactor with tronCreateTwo
class UpdateTronAccountTwo extends Component {
    constructor() {
        super();
        this.state = {
            tron_public: '',
            tron_private: '',
            tron_create: false,
        };
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.hideUpdateSuccess();
            // sessionStorage.removeItem('tron_public_key');
            // sessionStorage.removeItem('tron_private_key');
        };
    }

    async componentWillMount() {
        if (this.props.tron_create == true) {
            setTimeout(() => {
                // wait for one second for loading pdf js library
                this.setState({
                    tron_public: this.props.tron_public_key,
                    tron_private: this.props.tron_private_key,
                    tron_create: true,
                });
            }, 500);
        }
    }

    componentDidUpdate(prevProps) {
        // start to download pdf key file
        if (
            this.props.tron_public_key !== prevProps.tron_public_key &&
            this.props.tron_create
        ) {
            this.setState({
                tron_public: this.props.tron_public_key,
                tron_private: this.props.tron_private_key,
                tron_create: true,
            });
        }
    }

    render() {
        return (
            <div>
                <div>
                    <h3>{tt('tron_jsx.update_success')}</h3>
                </div>
                <div style={styles.container}>
                    <div>{tt('tron_jsx.update_success_content')}</div>
                    <div>
                        <PdfDownload
                            name={this.props.username}
                            tron_public_key={this.state.tron_public}
                            tron_private_key={this.state.tron_private}
                            newUser={false}
                            widthInches={8.5}
                            heightInches={11.0}
                            label={tt('tron_jsx.update_success_click')}
                            link={true}
                            download={this.state.tron_create}
                        />
                    </div>
                    <div>{tt('tron_jsx.update_success_content2')}</div>
                </div>
                <div style={styles.flowBelow}>
                    <button
                        type="submit"
                        className="button"
                        onClick={this.handleSubmit}
                    >
                        {tt('tron_jsx.safe_save_button')}
                    </button>
                </div>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const currentUser = state.user.get('current');

        const tron_address =
            currentUser && currentUser.has('tron_address')
                ? currentUser.get('tron_address')
                : '';
        const username =
            currentUser && currentUser.has('username')
                ? currentUser.get('username')
                : '';
        const tron_public_key =
            currentUser && currentUser.has('tron_public_key')
                ? currentUser.get('tron_public_key')
                : '';
        const tron_private_key =
            currentUser && currentUser.has('tron_private_key')
                ? currentUser.get('tron_private_key')
                : '';
        const tron_create =
            currentUser && currentUser.has('tron_create')
                ? currentUser.get('tron_create')
                : false;
        return {
            ...ownProps,
            tron_address,
            username,
            tron_public_key,
            tron_private_key,
            tron_create,
        };
    },
    dispatch => ({
        hideUpdateSuccess: () => {
            // if (e) e.preventDefault();
            dispatch(userActions.hideUpdateSuccess());
        },
    })
)(UpdateTronAccountTwo);
